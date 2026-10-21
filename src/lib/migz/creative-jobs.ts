import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getRequestStatus, submitImage, submitVideo } from "@/lib/higgsfield";
import { createAd, createAdCreative, uploadImage, uploadVideo, videoState } from "@/lib/meta/ads";
import { briefLabel, isImageBrief, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";

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
};

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
    const { requestId, statusUrl } = isImageBrief(input.brief)
      ? await submitImage(input.brief, opts)
      : await submitVideo(input.brief, opts);
    await update(job.id, { provider_request_id: requestId, status_url: statusUrl });
  } catch (e) {
    await update(job.id, { stage: "failed", error: e instanceof Error ? e.message : String(e) });
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
async function storeGenerated(job: Job, mediaUrl: string) {
  const image = isImageBrief(job.brief);
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`Couldn't download the generated ${image ? "image" : "video"} (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const headerType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const mime = image ? (IMAGE_TYPES[headerType] ? headerType : "image/png") : "video/mp4";
  const path = `${job.agent_id}/migz/${job.id}.${image ? IMAGE_TYPES[mime] : "mp4"}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("creatives")
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (uploadError) throw new Error(`Couldn't store the ${image ? "image" : "video"}: ${uploadError.message}`);

  const label = briefLabel(job.brief);
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
      parent_creative_id: job.parent_creative_id,
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

async function createLiveAd(job: Job, agent: Agent, media: Parameters<typeof createAdCreative>[1]["media"]) {
  const account = agent.meta_ad_account_id!;
  const name = `Migz · ${briefLabel(job.brief)}`.slice(0, 100);
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
    status: "ACTIVE",
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
      status: "ACTIVE",
      primary_text: job.brief.primary_text,
      headline: job.brief.headline,
    });
  }
  await supabaseAdmin.from("creatives").update({ status: "live" }).eq("id", job.creative_id!);
  await update(job.id, { stage: "launched" });
}

/** Moves one job forward as far as it can go right now. Safe to call repeatedly. */
export async function advanceJob(job: Job) {
  try {
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

      if (creative.kind === "image") {
        const { data: file, error } = await supabaseAdmin.storage.from("creatives").download(creative.storage_path);
        if (error || !file) throw new Error("Couldn't read the image from storage");
        const hash = await uploadImage(agent.meta_ad_account_id!, Buffer.from(await file.arrayBuffer()), job.id);
        await supabaseAdmin.from("creatives").update({ meta_image_hash: hash }).eq("id", job.creative_id!);
        await createLiveAd(job, agent, { kind: "image", imageHash: hash });
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
      return "launched";
    }

    return job.stage;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await update(job.id, { stage: "failed", error: message.slice(0, 500) });
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
