import "server-only";
import { briefDuration, imagePrompt, shotPrompts, videoPrompt, type CreativeBrief, type ImageBrief } from "@/lib/migz/brief";

// Higgsfield API (https://docs.higgsfield.ai): async generation. Submit -> store request_id and
// status_url -> poll or receive a webhook -> download the output (URLs are kept ~7 days, so we
// copy finished videos into our own Storage).
const BASE = "https://api.higgsfield.ai";
// Reel video, by model (HF_VIDEO_MODEL picks one; Seedance unless it says "kling"):
//  - Seedance 2.5 text-to-video, 1080p: one prompt that times its shots ("Shot 1 (0-3s): ..."), up to 30s.
//  - Kling 3.0 Standard: multi-shot prompts (hook shot + body shots). Kept so a bad day on one model is a
//    setting, not a deploy.
const SEEDANCE_PATH = () => process.env.HF_SEEDANCE_PATH || "/bytedance/seedance-2.5/text-to-video";
const KLING_PATH = () => process.env.HF_TEXT_TO_VIDEO_PATH || "/kling-video/v3.0/std/text-to-video";
/** What Seedance 2.5 1080p bills per second of video (Higgsfield's listed rate); HF_SEEDANCE_USD_PER_SECOND overrides. */
export const SEEDANCE_USD_PER_SECOND = 0.144;
// Models by job (override any path with an env var, no code change):
//  - Every still image (4:5 feeds, 9:16 Stories/Reels, 1:1 carousel cards) carries on-image text, so all
//    go to a model that renders text: HF_FEED_IMAGE_PATH. Ideogram 4.0 until a Nano Banana endpoint is
//    configured; Higgsfield's API docs don't list Nano Banana 2 Lite, so find its path in the console's
//    model page and set it. HF_FEED_IMAGE_BODY (JSON) adds that model's extra options.
//  - 9:16 reel video: Kling 3.0 Standard.
// Read at call time so a changed env var takes effect without a restart in tests.
const feedImagePath = () => process.env.HF_FEED_IMAGE_PATH || process.env.HF_TEXT_TO_IMAGE_PATH || "/ideogram/v4.0";

export type HiggsfieldStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

function authHeader() {
  const id = process.env.HF_API_KEY_ID;
  const secret = process.env.HF_API_KEY_SECRET;
  if (!id || !secret) throw new Error("HF_API_KEY_ID and HF_API_KEY_SECRET must be set");
  return `Key ${id}:${secret}`;
}

type SubmitOptions = { idempotencyKey: string; webhookUrl?: string | null };

async function submit(path: string, body: Record<string, unknown>, opts: SubmitOptions) {
  const url = new URL(path, BASE);
  if (opts.webhookUrl) url.searchParams.set("hf_webhook", opts.webhookUrl);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      // Safe retries after an ambiguous timeout: Higgsfield won't start a duplicate job
      "Idempotency-Key": opts.idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as {
    request_id?: string;
    status_url?: string;
    detail?: unknown;
    error?: unknown;
  };
  if (res.status === 403 && JSON.stringify(json.detail ?? json).includes("not_enough_credits")) {
    // Credits live on the account that owns the API key, separate from web-app subscription credits
    throw new Error("Higgsfield is out of credits on the API account, so no new creatives can be made until credits are added.");
  }
  if (!res.ok || !json.request_id || !json.status_url) {
    throw new Error(`Higgsfield ${res.status}: ${JSON.stringify(json.detail ?? json.error ?? json).slice(0, 300)}`);
  }
  return { requestId: json.request_id, statusUrl: json.status_url };
}

export type VideoModel = "seedance" | "kling";
export const videoModel = (): VideoModel => (process.env.HF_VIDEO_MODEL?.toLowerCase() === "kling" ? "kling" : "seedance");

/**
 * Which model and request body a video uses. Pure, so routing is testable. Both are written as a short-film
 * brief (see videoPrompt): hook shot first, then the body. Seedance voices nothing itself here: the narrator
 * is spoken by ElevenLabs and mixed in afterwards, so the prompt leaves the voiceover out (a model told to
 * "narrate" would speak it too, and the video would say everything twice).
 */
export function videoRequest(brief: CreativeBrief): { path: string; body: Record<string, unknown>; model: VideoModel } {
  if (videoModel() === "kling") {
    return {
      path: KLING_PATH(),
      model: "kling",
      body: {
        // Required even with multi_prompt; describes the whole piece
        prompt: videoPrompt(brief).slice(0, 2500),
        aspect_ratio: "9:16",
        sound: "on",
        multi_shots: true,
        multi_prompt: shotPrompts(brief),
      },
    };
  }
  return {
    path: SEEDANCE_PATH(),
    model: "seedance",
    body: {
      prompt: videoPrompt({ ...brief, voiceover: undefined }).slice(0, 2500),
      duration: Math.min(30, Math.max(4, Math.round(briefDuration(brief)))),
      resolution: process.env.HF_VIDEO_RESOLUTION || "1080p",
      aspect_ratio: "9:16",
      output_format: "mp4",
      generate_audio: true, // the scene's own sound; the narrator and music are laid over it
    },
  };
}

/** What a video should cost to generate, in dollars (null for a model whose rate isn't known here). */
export function videoCostUsd(brief: CreativeBrief) {
  if (videoModel() !== "seedance") return null;
  const rate = Number(process.env.HF_SEEDANCE_USD_PER_SECOND) || SEEDANCE_USD_PER_SECOND;
  return Math.round((videoRequest(brief).body.duration as number) * rate * 100) / 100;
}

/** Submits a 9:16 video for a brief, on the model chosen by HF_VIDEO_MODEL. */
export async function submitVideo(brief: CreativeBrief, opts: SubmitOptions) {
  const req = videoRequest(brief);
  return submit(req.path, req.body, opts);
}

/** Which model and request body a still image uses. Pure, so routing is testable. */
export function imageRequest(brief: ImageBrief): { path: string; body: Record<string, unknown>; model: "ideogram" | "feed_other" } {
  const feedPath = feedImagePath();
  const isIdeogram = feedPath.includes("ideogram");
  let extra: Record<string, unknown> = {};
  try {
    extra = process.env.HF_FEED_IMAGE_BODY ? (JSON.parse(process.env.HF_FEED_IMAGE_BODY) as Record<string, unknown>) : {};
  } catch {
    throw new Error("HF_FEED_IMAGE_BODY must be valid JSON");
  }
  return {
    path: feedPath,
    model: isIdeogram ? "ideogram" : "feed_other",
    body: {
      prompt: imagePrompt(brief).slice(0, 2048),
      aspect_ratio: brief.aspect_ratio,
      // Ideogram's slower mode renders text more cleanly; other models take their options from HF_FEED_IMAGE_BODY
      ...(isIdeogram ? { rendering_speed: "QUALITY" } : {}),
      ...extra,
    },
  };
}

/** Submits a still image with its text lines: 4:5, 9:16 or a 1:1 carousel card, all on the text-capable model. */
export async function submitImage(brief: ImageBrief, opts: SubmitOptions) {
  const req = imageRequest(brief);
  return submit(req.path, req.body, opts);
}

export async function getRequestStatus(statusUrl: string) {
  const res = await fetch(statusUrl, { headers: { Authorization: authHeader() }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    status?: HiggsfieldStatus;
    video?: { url?: string };
    images?: { url?: string }[];
    error?: unknown;
  };
  if (!res.ok || !json.status) throw new Error(`Higgsfield status ${res.status}`);
  return {
    status: json.status,
    videoUrl: json.video?.url ?? null,
    imageUrl: json.images?.[0]?.url ?? null,
    error: json.error ? JSON.stringify(json.error).slice(0, 300) : null,
  };
}
