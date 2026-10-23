import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getRequestStatus, submitImage, submitVideo } from "@/lib/higgsfield";
import { createAd, createAdCreative, uploadImage, uploadVideo, videoState } from "@/lib/meta/ads";
import { MetaApiError } from "@/lib/meta/graph";
import { isTestMode } from "@/lib/migz/test-mode";
import { alertAdmin, alertCreativeFailed } from "@/lib/migz/slack";
import { recordEventAlert } from "@/lib/admin/alerts";
import { briefLabel, cardBrief, isCarouselBrief, isImageBrief, isVideoBrief, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";
import { closeEvent, openEvent } from "@/lib/migz/events";
import { notifyAdLive, notifyCreativeReady } from "@/lib/migz/notify";
import { narrateVideo } from "@/lib/migz/narration";

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
  event_id?: number | null; // the Brain step open while this job works (Higgsfield, then Meta)
  parts?: CardPart[] | null; // carousels: one generation per card
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
        : await submitVideo(input.brief, opts);
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

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

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

  const headerType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
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

/** A creative made for the library (not launched): the agent hears about it with a preview. */
async function tellCreativeReady(job: Job) {
  try {
    const agent = await loadAgent(job.agent_id);
    const creativeIds = isCarouselBrief(job.brief)
      ? (job.parts ?? []).map((p) => p.creative_id).filter((id): id is string => !!id)
      : job.creative_id ? [job.creative_id] : [];
    await notifyCreativeReady(agent, { brief: job.brief, creativeIds });
  } catch (e) {
    console.error("creative ready update failed", e);
  }
}

async function createLiveAd(job: Job, agent: Agent, media: Parameters<typeof createAdCreative>[1]["media"]) {
  const account = agent.meta_ad_account_id!;
  const name = `Migz · ${briefLabel(job.brief)}`.slice(0, 100);
  const held = isTestMode(); // test mode: build the ad paused so it can be previewed but never deliver
  const metaCreativeId = await createAdCreative(account, {
    name,
    pageId: agent.meta_page_id!,
    instagramId: agent.meta_instagram_id,
    link: `${appUrl()}/${agent.slug}`,
    primaryText: job.brief.primary_text,
    headline: job.brief.headline,
    media,
  });
  const metaAdId = await createAd(account, {
    name,
    adsetId: job.launch_adset_id!,
    creativeId: metaCreativeId,
    status: held ? "PAUSED" : "ACTIVE",
  });

  const { data: adset } = await supabaseAdmin
    .from("ad_sets")
    .select("id")
    .eq("meta_adset_id", job.launch_adset_id!)
    .single();
  if (adset) {
    await supabaseAdmin.from("ads").insert({
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
  }
  await supabaseAdmin.from("creatives").update({ status: "live" }).eq("id", job.creative_id!);
  await update(job.id, { stage: "launched" });

  // Tell the agent, with a preview of the ad as it shows in the feed
  const creativeIds = isCarouselBrief(job.brief)
    ? (job.parts ?? []).map((p) => p.creative_id).filter((id): id is string => !!id)
    : [job.creative_id!];
  await notifyAdLive(agent, {
    brief: job.brief,
    creativeIds,
    metaAdsetId: job.launch_adset_id!,
    held,
    videoThumbnail: media.kind === "video" ? media.thumbnailUrl : null,
  }).catch((e) => console.error("ad live update failed", e));
}

const CLAIM_SECONDS = 120; // longer than any single step; a crashed run's claim expires after this

/**
 * Takes the job for this run. Only one caller wins at a time (the webhook, the cron and the approval
 * flow can all reach the same job), so a job is never advanced twice at once. Returns false when
 * someone else is on it. Before the claim migration has run, jobs are advanced unlocked as before.
 */
async function claim(jobId: string) {
  const stale = new Date(Date.now() - CLAIM_SECONDS * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("creative_jobs")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", jobId)
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .select("id");
  if (error) return true;
  return (data ?? []).length === 1;
}

async function release(jobId: string) {
  await supabaseAdmin.from("creative_jobs").update({ claimed_at: null }).eq("id", jobId);
}

/**
 * Moves one job forward as far as it can go right now. Safe to call repeatedly, and from several places
 * at once: whoever claims the job advances it, the others see "busy" and leave it for the next tick.
 */
export async function advanceJob(job: Job) {
  if (!(await claim(job.id))) return "busy";
  try {
    // The caller's copy may be stale (another run could have moved it on just before we claimed it)
    const { data: fresh } = await supabaseAdmin.from("creative_jobs").select("*").eq("id", job.id).maybeSingle();
    return await advance((fresh as Job | null) ?? job);
  } finally {
    await release(job.id);
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
      if (!job.launch_adset_id) await tellCreativeReady(job);
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
      if (!job.launch_adset_id) await tellCreativeReady(job);
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
