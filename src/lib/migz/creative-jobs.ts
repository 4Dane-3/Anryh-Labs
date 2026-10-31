import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { landingUrl } from "@/lib/booking/sites";
import type { Agent } from "@/lib/booking/data";
import { getRequestStatus, submitImage, submitVideo, videoModel } from "@/lib/higgsfield";
import { createAd, createAdCreative, creativeEnhancementsOn, uploadImage, uploadVideo, videoState } from "@/lib/meta/ads";
import { MetaApiError } from "@/lib/meta/graph";
import { isTestMode } from "@/lib/migz/test-mode";
import { alertAdmin, alertCreativeFailed } from "@/lib/migz/slack";
import { recordEventAlert } from "@/lib/admin/alerts";
import { briefLabel, cardBrief, fitBrief, isCarouselBrief, isImageBrief, isVideoBrief, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";
import { closeEvent, openEvent } from "@/lib/migz/events";
import { narrateVideo } from "@/lib/migz/narration";
import { addLogoToImage, addLogoToVideo, DEFAULT_LOGO_CORNER, isLogoCorner, type LogoCorner } from "@/lib/migz/endcard";
import { DEFAULT_VIDEO_TIER, isVideoTier, VIDEO_TIERS, type VideoTier } from "@/lib/ad-options";
import { creativeMix, INCLUDED_VIDEOS, videoPriceFor } from "@/lib/campaign-plan";
import { getActiveBatch } from "@/lib/dashboard/batches";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { leadFormFor } from "@/lib/migz/leads";

// Creative jobs move through stages, advanced by the creatives cron (every 10 min) and the
// Higgsfield webhook:  generating -> stored -> meta_processing -> launched   (or failed)
// Agent uploads being launched skip straight to "stored". Generated images skip "meta_processing":
// Meta takes image bytes directly and returns a hash we can use right away.

const MAX_ATTEMPTS = 72; // ~12 hours of 10-minute checks before giving up

type Job = {
  id: string;
  agent_id: string;
  action_id: string | null;
  provider_request_id: string | null;
  status_url: string | null;
  stage: "generating" | "stored" | "meta_processing" | "launched" | "failed";
  brief: AnyBrief;
  parent_creative_id: string | null;
  creative_id: string | null;
  launch_adset_id: string | null;
  attempts: number;
  meta_creative_id?: string | null; // saved as soon as Meta makes them, so a retried launch never makes a second ad
  meta_ad_id?: string | null;
  event_id?: number | null; // the Brain step open while this job works (Higgsfield, then Meta)
  parts?: CardPart[] | null; // carousels: one generation per card
  video_charge_cents?: number; // what the agent was charged for this video (missing before its migration)
};

type CardPart = { request_id: string; status_url: string; creative_id: string | null };

const kindOf = (brief: AnyBrief) => (isCarouselBrief(brief) ? "carousel" : isImageBrief(brief) ? "image" : "video");

/** Opens the job's live Brain step (closing any previous one) so the Brain shows who's working on it. */
async function openJobEvent(job: Job, e: { step: "drafting" | "acting"; tier: "higgsfield" | "code"; summary: string }, runId: string | null = null) {
  await closeEvent(job.event_id);
  const id = await openEvent({ agentId: job.agent_id, runId, ...e });
  job.event_id = id;
  // Separate write: a missing column (before the migration) must never block the job's own progress
  await supabaseAdmin.from("creative_jobs").update({ event_id: id }).eq("id", job.id);
}

async function closeJobEvent(job: Job, summary: string) {
  if (!job.event_id) return;
  await closeEvent(job.event_id, { summary });
  job.event_id = null;
  await supabaseAdmin.from("creative_jobs").update({ event_id: null }).eq("id", job.id);
}

export function webhookToken(jobId: string) {
  return createHmac("sha256", process.env.CRON_SECRET ?? "").update(`hf:${jobId}`).digest("hex");
}

export function validWebhookToken(jobId: string, token: string) {
  const expected = Buffer.from(webhookToken(jobId));
  const given = Buffer.from(token);
  return !!process.env.CRON_SECRET && expected.length === given.length && timingSafeEqual(expected, given);
}

function appUrl() {
  const url = process.env.APP_URL?.replace(/\/$/, "");
  if (!url) throw new Error("APP_URL must be set (Meta needs the public landing page link)");
  return url;
}

async function update(jobId: string, patch: Record<string, unknown>) {
  await supabaseAdmin
    .from("creative_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/** Starts a Higgsfield generation for a brief. Returns the job id. */
export async function enqueueGeneration(input: {
  agentId: string;
  brief: AnyBrief;
  parentCreativeId?: string | null;
  launchAdsetId?: string | null;
  actionId?: string | null;
  runId?: string | null;
}) {
  const { data: job, error } = await supabaseAdmin
    .from("creative_jobs")
    .insert({
      agent_id: input.agentId,
      brief: input.brief,
      parent_creative_id: input.parentCreativeId ?? null,
      launch_adset_id: input.launchAdsetId ?? null,
      action_id: input.actionId ?? null,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(`Couldn't create the creative job: ${error?.message}`);

  try {
    const base = process.env.APP_URL?.replace(/\/$/, "");
    const webhookUrl = base
      ? `${base}/api/webhooks/higgsfield?job=${job.id}&token=${webhookToken(job.id)}`
      : null;
    const opts = { idempotencyKey: job.id, webhookUrl };
    // A video's tier decides its model; a Seedance video is charged to the agent's ad funds before it starts
    const tier = isVideoBrief(input.brief) ? await chargeForVideo(input.agentId, job.id, input.brief, input.launchAdsetId ?? null) : DEFAULT_VIDEO_TIER;
    if (isCarouselBrief(input.brief)) {
      // Each card is its own square still; the job is "generated" once every card is back
      const parts: CardPart[] = [];
      for (const i of input.brief.cards.keys()) {
        const r = await submitImage(cardBrief(input.brief, i), { ...opts, idempotencyKey: `${job.id}-${i}` });
        parts.push({ request_id: r.requestId, status_url: r.statusUrl, creative_id: null });
      }
      await update(job.id, { provider_request_id: parts[0].request_id, status_url: parts[0].status_url, parts });
    } else {
      const { requestId, statusUrl } = isImageBrief(input.brief)
        ? await submitImage(input.brief, opts)
        : await submitVideo(VIDEO_TIERS[tier].model === "kling" ? fitBrief(input.brief, VIDEO_TIERS[tier].seconds) : input.brief, opts, tier);
      await update(job.id, { provider_request_id: requestId, status_url: statusUrl });
    }
    await openJobEvent(
      { id: job.id, agent_id: input.agentId, event_id: null } as Job,
      { step: "drafting", tier: "higgsfield", summary: `Making a ${kindOf(input.brief)}: ${briefLabel(input.brief)}`.slice(0, 200) },
      input.runId ?? null,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await update(job.id, { stage: "failed", error: message });
    await refundVideo(job.id).catch((r) => console.error("refunding the video failed", r));
    try {
      const { data: owner } = await supabaseAdmin.from("agents").select("slug").eq("id", input.agentId).single();
      await alertCreativeFailed(input.agentId, owner?.slug ?? "unknown", job.id, message);
    } catch {
      // alerts are best effort
    }
    throw e;
  }
  return job.id;
}

/** Queues an existing library creative (e.g. an agent upload) to go live in an ad set. */
export async function enqueueLaunch(input: {
  agentId: string;
  creativeId: string;
  launchAdsetId: string;
  primaryText: string;
  headline: string;
  actionId?: string | null;
}) {
  const brief: CreativeBrief = {
    concept: "Agent upload",
    style: "",
    hook_line: "",
    hook_shot: "",
    body_shots: [],
    primary_text: input.primaryText,
    headline: input.headline,
  };
  const { data, error } = await supabaseAdmin
    .from("creative_jobs")
    .insert({
      agent_id: input.agentId,
      stage: "stored",
      brief,
      creative_id: input.creativeId,
      launch_adset_id: input.launchAdsetId,
      action_id: input.actionId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Couldn't queue the launch: ${error?.message}`);
  return data.id as string;
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * Picks the tier a new video is made on and charges for it. A Seedance tier takes its price from the free
 * ad balance (one wallet line per video, so it shows in the funds history) before anything is submitted.
 * Falls back to Standard, and tells the agent, when the batch has used its paid videos or the free balance
 * can't cover one: the campaign keeps its video either way. Returns the tier to submit on.
 */
async function chargeForVideo(agentId: string, jobId: string, brief: CreativeBrief, launchAdsetId: string | null): Promise<VideoTier> {
  const { data: row, error } = await supabaseAdmin.from("agents").select("video_tier").eq("id", agentId).single();
  const tier: VideoTier = !error && isVideoTier(row?.video_tier) ? row.video_tier : DEFAULT_VIDEO_TIER;
  // HF_VIDEO_MODEL=kling (staff's switch for a bad day on Seedance) makes it on Kling: nothing to charge
  if (!VIDEO_TIERS[tier].priceCents || videoModel(tier) !== "seedance") {
    await update(jobId, { video_model: videoModel(tier), video_charge_cents: 0 });
    return tier;
  }

  const fallback = async (why: string) => {
    await update(jobId, { video_model: videoModel(DEFAULT_VIDEO_TIER), video_charge_cents: 0 });
    await supabaseAdmin.from("ad_actions").insert({
      agent_id: agentId,
      kind: "creative",
      title: "Made this video on Standard",
      detail: `${why} So Migz made "${briefLabel(brief)}" on Standard (Kling 3.0, included) instead, and nothing was charged.`.slice(0, 500),
      status: "applied",
      tool: "system_video_tier",
    });
    return DEFAULT_VIDEO_TIER;
  };

  // Which video this is for the ad set in this campaign: the first two are at list price, the rest 20% off,
  // up to the ad set's creative mix (library videos count together, against the included two)
  const batch = await getActiveBatch(agentId).catch(() => null);
  const since = batch?.started_at ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  let paid = supabaseAdmin
    .from("creative_jobs")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .neq("id", jobId)
    .gt("video_charge_cents", 0)
    .neq("stage", "failed")
    .gte("created_at", since);
  paid = launchAdsetId ? paid.eq("launch_adset_id", launchAdsetId) : paid.is("launch_adset_id", null);
  const [{ count }, { data: set }] = await Promise.all([
    paid,
    launchAdsetId ? supabaseAdmin.from("ad_sets").select("daily_budget_cents").eq("meta_adset_id", launchAdsetId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // A video in a two-weekly creative wave is past the setup's mix: always an extra (20% off), and the agent
  // approved its price before it was made
  const wave = typeof brief.wave === "number";
  const nth = wave ? Math.max(count ?? 0, INCLUDED_VIDEOS) : count ?? 0;
  const cap = set ? creativeMix(set.daily_budget_cents).videos : INCLUDED_VIDEOS;
  if (!wave && nth >= cap)
    return fallback(`This ad set already has its ${cap} Seedance videos for this campaign, the most its budget calls for.`);
  const price = videoPriceFor(tier, nth);
  const free = await getBalanceCents(agentId);
  if (free < price)
    return fallback(`A ${VIDEO_TIERS[tier].title} video costs ${money(price)}, and your free ad balance is ${money(Math.max(0, free))}.`);

  const { error: charged } = await supabaseAdmin.from("wallet_transactions").insert({
    agent_id: agentId,
    kind: "adjustment",
    amount_cents: -price,
    status: "completed",
    description: `${VIDEO_TIERS[tier].title} video for your ads${wave ? " (new-ads wave, extra, 20% off)" : nth >= INCLUDED_VIDEOS ? " (extra, 20% off)" : ""}: ${briefLabel(brief)}`.slice(0, 200),
    external_id: `video:${jobId}`,
  });
  if (charged && charged.code !== "23505") throw new Error(`Couldn't charge for the video: ${charged.message}`);
  await update(jobId, { video_model: "seedance", video_charge_cents: price });
  return tier;
}

/** Gives a video's charge back (once): its generation never produced anything, or Meta rejected its ad. */
export async function refundVideo(jobId: string, description = "Refund: the Seedance video couldn't be made") {
  const { data: job } = await supabaseAdmin.from("creative_jobs").select("agent_id, video_charge_cents").eq("id", jobId).single();
  const cents = (job as { video_charge_cents?: number } | null)?.video_charge_cents ?? 0;
  if (!job || cents <= 0) return false;
  const { error } = await supabaseAdmin.from("wallet_transactions").insert({
    agent_id: job.agent_id,
    kind: "refund",
    amount_cents: cents,
    status: "completed",
    description,
    external_id: `video:${jobId}:refund`,
  });
  if (error && error.code !== "23505") throw new Error(`Couldn't refund the video: ${error.message}`);
  return !error;
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** The agent's logo and the corner it sits in, or null when they have none (or its migrations haven't run). */
async function agentLogo(agentId: string): Promise<{ logo: Buffer; corner: LogoCorner } | null> {
  const full = await supabaseAdmin.from("agents").select("ad_logo_path, ad_logo_corner").eq("id", agentId).single();
  // Before the corner migration runs, the logo still works, in the default corner
  const { data } = full.error ? await supabaseAdmin.from("agents").select("ad_logo_path").eq("id", agentId).single() : full;
  const row = data as { ad_logo_path?: string | null; ad_logo_corner?: string | null } | null;
  if (!row?.ad_logo_path) return null;
  const { data: file, error } = await supabaseAdmin.storage.from("creatives").download(row.ad_logo_path);
  if (error || !file) throw new Error(`Couldn't read the agent's logo: ${error?.message ?? "missing file"}`);
  return { logo: Buffer.from(await file.arrayBuffer()), corner: isLogoCorner(row.ad_logo_corner) ? row.ad_logo_corner : DEFAULT_LOGO_CORNER };
}

/** Copies a finished generation into our Storage (Higgsfield only keeps outputs ~7 days). */
async function storeGenerated(job: Job, mediaUrl: string, card?: { index: number; parentId: string | null }) {
  const image = !isVideoBrief(job.brief);
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`Couldn't download the generated ${image ? "image" : "video"} (${res.status})`);
  let bytes: Buffer = Buffer.from(await res.arrayBuffer());

  // The video model doesn't voice the narrator: speak the voiceover and lay it over the finished video.
  // If that fails the video is kept without narration (never lose a paid generation) and staff are told.
  if (!image && !card && isVideoBrief(job.brief) && job.brief.voiceover) {
    try {
      bytes = await narrateVideo(bytes, job.brief.voiceover, job.brief.narrator ?? "female", job.brief.mood);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("narration failed", reason);
      await alertAdmin(`*Narration failed* on creative job \`${job.id.slice(0, 8)}\`; the video was kept without a voiceover.\n>${reason.slice(0, 300)}`).catch(() => {});
      await recordEventAlert({ agentId: job.agent_id, key: `narration_failed:${job.id}`, severity: "warn", title: "Narration failed", detail: `The video was kept without a voiceover: ${reason}` });
    }
  }

  // The agent's logo on every Migz ad: a small corner mark on images and videos, plus the end card on videos
  // (the scene blurs and zooms out while the logo fades in). Like narration, a failure keeps the creative as
  // it is (never lose a paid generation) and staff are told.
  let stampedImage = false;
  try {
    const found = await agentLogo(job.agent_id);
    if (found) {
      const stamped = image ? await addLogoToImage(bytes, found.logo, found.corner) : await addLogoToVideo(bytes, found.logo, found.corner);
      if (stamped) {
        bytes = stamped;
        stampedImage = image; // a stamped image comes back as a PNG
      }
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("logo failed", reason);
    await alertAdmin(`*Logo failed* on creative job \`${job.id.slice(0, 8)}\`; the creative was kept without it.\n>${reason.slice(0, 300)}`).catch(() => {});
    await recordEventAlert({ agentId: job.agent_id, key: `logo_failed:${job.id}`, severity: "warn", title: "Logo failed", detail: `The creative was kept without its logo: ${reason}` });
  }

  const headerType = stampedImage ? "image/png" : (res.headers.get("content-type")?.split(";")[0].trim() ?? "");
  const mime = image ? (IMAGE_TYPES[headerType] ? headerType : "image/png") : "video/mp4";
  const path = `${job.agent_id}/migz/${job.id}${card ? `-${card.index}` : ""}.${image ? IMAGE_TYPES[mime] : "mp4"}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("creatives")
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (uploadError) throw new Error(`Couldn't store the ${image ? "image" : "video"}: ${uploadError.message}`);

  const brief = job.brief;
  const label = card && isCarouselBrief(brief)
    ? `${briefLabel(cardBrief(brief, card.index))} (card ${card.index + 1} of ${brief.cards.length})`
    : briefLabel(brief);
  const { data: creative, error } = await supabaseAdmin
    .from("creatives")
    .insert({
      agent_id: job.agent_id,
      kind: image ? "image" : "video",
      storage_path: path,
      file_name: `Migz · ${label}`.slice(0, 200),
      mime_type: mime,
      size_bytes: bytes.length,
      status: job.launch_adset_id ? "in_review" : "submitted",
      source: "migz",
      parent_creative_id: card ? card.parentId : job.parent_creative_id, // a carousel's second card points at its first
      hook: label,
      script: job.brief,
    })
    .select("id")
    .single();
  if (error || !creative) throw new Error(`Couldn't save the creative: ${error?.message}`);
  return creative.id as string;
}

async function loadAgent(agentId: string): Promise<Agent> {
  const { data, error } = await supabaseAdmin.from("agents").select("*").eq("id", agentId).single();
  if (error || !data) throw new Error("Agent not found");
  return data as Agent;
}

/**
 * Reads a new creative back from Meta (a GET, nothing changed) and tells staff if any Advantage+ enhancement
 * is still on, so Meta never rewrites an ad unnoticed. Never fails the launch.
 */
export async function checkCreativeEnhancements(agent: Pick<Agent, "id" | "slug">, creativeId: string, name: string) {
  try {
    const on = await creativeEnhancementsOn(creativeId);
    if (!on.length) return;
    const detail = `Meta creative ${creativeId} ("${name}") still has ${on.join(", ")} switched on. Turn it off in Ads Manager or remake the creative.`;
    await alertAdmin(`*Advantage+ enhancements on* for \`${agent.slug}\`: ${detail}`).catch(() => {});
    await recordEventAlert({ agentId: agent.id, key: `enhancements_on:${creativeId}`, severity: "warn", title: "Meta enhancements still on", detail });
  } catch (e) {
    console.error("couldn't read the creative's enhancements back", e instanceof Error ? e.message : e);
  }
}

async function createLiveAd(job: Job, agent: Agent, media: Parameters<typeof createAdCreative>[1]["media"]) {
  const account = agent.meta_ad_account_id!;
  const name = `Migz · ${briefLabel(job.brief)}`.slice(0, 100);
  const held = isTestMode(); // test mode: build the ad paused so it can be previewed but never deliver
  // Each Meta object is recorded on the job the moment it exists: a run cut off after this point resumes
  // from it instead of making a second live ad
  let metaCreativeId = job.meta_creative_id ?? null;
  if (!metaCreativeId) {
    metaCreativeId = await createAdCreative(account, {
      name,
      pageId: agent.meta_page_id!,
      instagramId: agent.meta_instagram_id,
      link: landingUrl(agent.slug, appUrl()),
      primaryText: job.brief.primary_text,
      headline: job.brief.headline,
      // An instant-form ad set's ads open the agent's lead form instead of the booking page
      leadFormId: await leadFormFor(agent, job.launch_adset_id!),
      media,
    });
    await update(job.id, { meta_creative_id: metaCreativeId });
    await checkCreativeEnhancements(agent, metaCreativeId, name);
  }
  let metaAdId = job.meta_ad_id ?? null;
  if (!metaAdId) {
    metaAdId = await createAd(account, {
      name,
      adsetId: job.launch_adset_id!,
      creativeId: metaCreativeId,
      status: held ? "PAUSED" : "ACTIVE",
    });
    await update(job.id, { meta_ad_id: metaAdId });
  }

  const { data: adset } = await supabaseAdmin
    .from("ad_sets")
    .select("id")
    .eq("meta_adset_id", job.launch_adset_id!)
    .single();
  const { data: tracked } = await supabaseAdmin.from("ads").select("id").eq("meta_ad_id", metaAdId).maybeSingle();
  if (adset && !tracked) {
    const { error } = await supabaseAdmin.from("ads").insert({
      agent_id: agent.id,
      adset_id: adset.id,
      creative_id: job.creative_id,
      meta_ad_id: metaAdId,
      meta_creative_id: metaCreativeId,
      name,
      status: held ? "PAUSED" : "ACTIVE",
      held_by_test_mode: held,
      primary_text: job.brief.primary_text,
      headline: job.brief.headline,
    });
    // The ad exists in Meta either way; an untracked live ad would spend without Migz seeing it, so staff are told
    if (error)
      await alertAdmin(`*Untracked live ad* for \`${agent.slug}\`: Meta ad \`${metaAdId}\` was created but couldn't be recorded.\n>${error.message.slice(0, 300)}`).catch(() => {});
  }
  await supabaseAdmin.from("creatives").update({ status: "live" }).eq("id", job.creative_id!);
  await update(job.id, { stage: "launched" });
}

// Longer than any route that advances jobs may run (maxDuration 300s), so a live run's claim never expires
// under it; a crashed run's claim expires after this
const CLAIM_SECONDS = 330;

/**
 * Takes the job for this run. Only one caller wins at a time (the webhook, the cron and the approval
 * flow can all reach the same job), so a job is never advanced twice at once. Returns the claim (to
 * release it with), or null when someone else is on it. Before the claim migration has run, jobs are
 * advanced unlocked as before.
 */
async function claim(jobId: string) {
  const stale = new Date(Date.now() - CLAIM_SECONDS * 1000).toISOString();
  const token = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("creative_jobs")
    .update({ claimed_at: token })
    .eq("id", jobId)
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .select("id");
  if (error) return token;
  return (data ?? []).length === 1 ? token : null;
}

/** Lets go of the job only if this run still holds it (a run that outlived its claim must not free someone else's). */
async function release(jobId: string, token: string) {
  await supabaseAdmin.from("creative_jobs").update({ claimed_at: null }).eq("id", jobId).eq("claimed_at", token);
}

/**
 * Moves one job forward as far as it can go right now. Safe to call repeatedly, and from several places
 * at once: whoever claims the job advances it, the others see "busy" and leave it for the next tick.
 */
export async function advanceJob(job: Job) {
  const token = await claim(job.id);
  if (!token) return "busy";
  try {
    // The caller's copy may be stale (another run could have moved it on just before we claimed it)
    const { data: fresh } = await supabaseAdmin.from("creative_jobs").select("*").eq("id", job.id).maybeSingle();
    return await advance((fresh as Job | null) ?? job);
  } finally {
    await release(job.id, token);
  }
}

async function advance(job: Job) {
  try {
    if (job.stage === "generating" && isCarouselBrief(job.brief)) {
      const parts = job.parts ?? [];
      if (parts.length !== job.brief.cards.length) throw new Error("This carousel is missing its card generations");
      let waiting = false;
      for (const [i, part] of parts.entries()) {
        if (part.creative_id) continue;
        const status = await getRequestStatus(part.status_url);
        if (status.status === "queued" || status.status === "in_progress") {
          waiting = true;
          continue;
        }
        if (status.status !== "completed" || !status.imageUrl)
          throw new Error(status.status === "nsfw" ? "Higgsfield's moderation rejected a carousel card" : `Carousel card ${i + 1}: generation ${status.status}${status.error ? `: ${status.error}` : ""}`);
        part.creative_id = await storeGenerated(job, status.imageUrl, { index: i, parentId: parts[0].creative_id });
        await update(job.id, { parts });
      }
      if (waiting) {
        if (job.attempts + 1 >= MAX_ATTEMPTS) throw new Error("Generation took too long");
        await update(job.id, { attempts: job.attempts + 1 });
        return "waiting";
      }
      job = { ...job, stage: "stored", creative_id: parts[0].creative_id, parts };
      await update(job.id, { stage: "stored", creative_id: parts[0].creative_id, attempts: 0 });
      await closeJobEvent(job, `Made a carousel: ${briefLabel(job.brief)}`.slice(0, 200));
    }

    if (job.stage === "generating") {
      if (!job.status_url) throw new Error("Job has no Higgsfield status URL");
      const status = await getRequestStatus(job.status_url);
      if (status.status === "queued" || status.status === "in_progress") {
        if (job.attempts + 1 >= MAX_ATTEMPTS) throw new Error("Generation took too long");
        await update(job.id, { attempts: job.attempts + 1 });
        return "waiting";
      }
      const mediaUrl = isImageBrief(job.brief) ? status.imageUrl : status.videoUrl;
      if (status.status !== "completed" || !mediaUrl) {
        throw new Error(
          status.status === "nsfw"
            ? "Higgsfield's moderation rejected this creative"
            : `Generation ${status.status}${status.error ? `: ${status.error}` : ""}`,
        );
      }
      const creativeId = await storeGenerated(job, mediaUrl);
      job = { ...job, stage: "stored", creative_id: creativeId };
      await update(job.id, { stage: "stored", creative_id: creativeId, attempts: 0 });
      await closeJobEvent(job, `Made a ${kindOf(job.brief)}: ${briefLabel(job.brief)}`.slice(0, 200));
    }

    if (job.stage === "stored") {
      if (!job.launch_adset_id) return "stored"; // library only
      const agent = await loadAgent(job.agent_id);
      const { data: creative } = await supabaseAdmin
        .from("creatives")
        .select("kind, storage_path, mime_type")
        .eq("id", job.creative_id!)
        .single();
      if (!creative) throw new Error("Creative not found");
      await openJobEvent(job, { step: "acting", tier: "code", summary: `${creative.kind === "image" ? "Building" : "Uploading the video for"} the ad in Meta: ${briefLabel(job.brief)}`.slice(0, 200) });

      if (isCarouselBrief(job.brief)) {
        const brief = job.brief;
        const ids = (job.parts ?? []).map((p) => p.creative_id).filter((id): id is string => !!id);
        if (ids.length !== brief.cards.length) throw new Error("This carousel is missing a card");
        const cards: { imageHash: string; headline: string }[] = [];
        for (const [i, id] of ids.entries()) {
          const { data: row } = await supabaseAdmin.from("creatives").select("storage_path").eq("id", id).single();
          if (!row) throw new Error(`Carousel card ${i + 1} is missing`);
          const { data: file, error } = await supabaseAdmin.storage.from("creatives").download(row.storage_path);
          if (error || !file) throw new Error(`Couldn't read carousel card ${i + 1} from storage`);
          const hash = await uploadImage(agent.meta_ad_account_id!, Buffer.from(await file.arrayBuffer()), `${job.id}-${i}`);
          await supabaseAdmin.from("creatives").update({ meta_image_hash: hash }).eq("id", id);
          cards.push({ imageHash: hash, headline: brief.cards[i].headline });
        }
        await createLiveAd(job, agent, { kind: "carousel", cards });
        await supabaseAdmin.from("creatives").update({ status: "live" }).in("id", ids);
        await closeJobEvent(job, `Carousel built in Meta: ${briefLabel(job.brief)}`.slice(0, 200));
        return "launched";
      }

      if (creative.kind === "image") {
        const { data: file, error } = await supabaseAdmin.storage.from("creatives").download(creative.storage_path);
        if (error || !file) throw new Error("Couldn't read the image from storage");
        const hash = await uploadImage(agent.meta_ad_account_id!, Buffer.from(await file.arrayBuffer()), job.id);
        await supabaseAdmin.from("creatives").update({ meta_image_hash: hash }).eq("id", job.creative_id!);
        await createLiveAd(job, agent, { kind: "image", imageHash: hash });
        await closeJobEvent(job, `Ad built in Meta: ${briefLabel(job.brief)}`.slice(0, 200));
        return "launched";
      }

      // Meta fetches the video itself from a short-lived signed URL
      const { data: signed, error } = await supabaseAdmin.storage
        .from("creatives")
        .createSignedUrl(creative.storage_path, 3600);
      if (error || !signed) throw new Error("Couldn't sign the video URL");
      const videoId = await uploadVideo(agent.meta_ad_account_id!, signed.signedUrl, job.id);
      await supabaseAdmin.from("creatives").update({ meta_video_id: videoId }).eq("id", job.creative_id!);
      await update(job.id, { stage: "meta_processing", attempts: 0 });
      return "meta_processing";
    }

    if (job.stage === "meta_processing") {
      const agent = await loadAgent(job.agent_id);
      const { data: creative } = await supabaseAdmin
        .from("creatives")
        .select("meta_video_id")
        .eq("id", job.creative_id!)
        .single();
      if (!creative?.meta_video_id) throw new Error("Creative has no Meta video id");
      const state = await videoState(creative.meta_video_id);
      if (state.status === "error") throw new Error("Meta couldn't process the video");
      if (state.status !== "ready" || !state.thumbnail) {
        if (job.attempts + 1 >= MAX_ATTEMPTS) throw new Error("Meta video processing took too long");
        await update(job.id, { attempts: job.attempts + 1 });
        return "waiting";
      }
      await createLiveAd(job, agent, { kind: "video", videoId: creative.meta_video_id, thumbnailUrl: state.thumbnail });
      await closeJobEvent(job, `Ad built in Meta: ${briefLabel(job.brief)}`.slice(0, 200));
      return "launched";
    }

    return job.stage;
  } catch (e) {
    // Meta's top-level message is often just "Invalid parameter"; its user message says what's wrong
    const message =
      e instanceof MetaApiError
        ? `Meta: ${e.userMessage ?? e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    await update(job.id, { stage: "failed", error: message.slice(0, 500) });
    // The agent only pays for a video that runs: a generation that never came back (failed, blocked, timed
    // out) or an ad Meta refused to make gets its charge back. A live ad Meta disapproves later is refunded
    // by the sync (refundRejectedVideo).
    if (!job.meta_ad_id)
      await refundVideo(job.id, job.stage === "generating" ? "Refund: the Seedance video couldn't be made" : "Refund: Meta didn't accept the ad for your Seedance video").catch((r) =>
        console.error("refunding the video failed", r),
      );
    await closeJobEvent(job, `Failed: ${message}`.slice(0, 200)).catch(() => {});
    try {
      const { data: owner } = await supabaseAdmin.from("agents").select("slug").eq("id", job.agent_id).single();
      await alertCreativeFailed(job.agent_id, owner?.slug ?? "unknown", job.id, message);
    } catch {
      // alerts are best effort
    }
    if (job.creative_id) await supabaseAdmin.from("creatives").update({ status: "rejected", review_note: message.slice(0, 200) }).eq("id", job.creative_id);
    return "failed";
  }
}

/** Advances every open job, oldest first, until the time budget runs out. */
export async function advanceOpenJobs(deadlineMs: number) {
  const { data } = await supabaseAdmin
    .from("creative_jobs")
    .select("*")
    .or("stage.in.(generating,meta_processing),and(stage.eq.stored,launch_adset_id.not.is.null)")
    .order("updated_at")
    .limit(50);

  const results: Record<string, string> = {};
  for (const job of (data ?? []) as Job[]) {
    if (Date.now() > deadlineMs) break;
    results[job.id] = await advanceJob(job);
  }
  return results;
}

export async function advanceJobById(jobId: string) {
  const { data } = await supabaseAdmin.from("creative_jobs").select("*").eq("id", jobId).maybeSingle();
  return data ? advanceJob(data as Job) : "not_found";
}

/** Meta disapproved an ad: if its video was a paid one, the agent gets the charge back (once). */
export async function refundRejectedVideo(agentId: string, metaAdId: string) {
  const { data: ad } = await supabaseAdmin.from("ads").select("creative_id").eq("agent_id", agentId).eq("meta_ad_id", metaAdId).maybeSingle();
  if (!ad?.creative_id) return false;
  const { data: jobs, error } = await supabaseAdmin.from("creative_jobs").select("id").eq("creative_id", ad.creative_id).gt("video_charge_cents", 0);
  if (error) return false; // before the video-tier migration nothing was charged
  let refunded = false;
  for (const j of jobs ?? []) refunded = (await refundVideo(j.id, "Refund: Meta rejected the ad for your Seedance video")) || refunded;
  return refunded;
}
