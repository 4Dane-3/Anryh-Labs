import "server-only";
import { HOOK_SECONDS, imagePrompt, type CreativeBrief, type ImageBrief } from "@/lib/migz/brief";

// Higgsfield API (https://docs.higgsfield.ai): async generation. Submit -> store request_id and
// status_url -> poll or receive a webhook -> download the output (URLs are kept ~7 days, so we
// copy finished videos into our own Storage).
const BASE = "https://api.higgsfield.ai";
// Kling 3.0 Standard text-to-video: 9:16 output and multi-shot prompts (hook shot + body shots)
const TEXT_TO_VIDEO = process.env.HF_TEXT_TO_VIDEO_PATH || "/kling-video/v3.0/std/text-to-video";
// Ideogram 4.0: strong at rendering on-image text, supports 4:5 and 9:16
const TEXT_TO_IMAGE = process.env.HF_TEXT_TO_IMAGE_PATH || "/ideogram/v4.0";

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
  if (!res.ok || !json.request_id || !json.status_url) {
    throw new Error(`Higgsfield ${res.status}: ${JSON.stringify(json.detail ?? json.error ?? json).slice(0, 300)}`);
  }
  return { requestId: json.request_id, statusUrl: json.status_url };
}

/** Submits a 9:16 multi-shot video: the hook shot first, then the body shots. */
export async function submitVideo(brief: CreativeBrief, opts: SubmitOptions) {
  const shots = [
    { prompt: `${brief.hook_shot}. ${brief.style}`.slice(0, 512), duration: HOOK_SECONDS },
    ...brief.body_shots.map((s) => ({ prompt: `${s.prompt}. ${brief.style}`.slice(0, 512), duration: s.duration })),
  ];

  return submit(
    TEXT_TO_VIDEO,
    {
      // Required even with multi_prompt; describes the whole piece
      prompt: `${brief.concept}. ${brief.style}`.slice(0, 2500),
      aspect_ratio: "9:16",
      sound: "on",
      multi_shots: true,
      multi_prompt: shots,
    },
    opts,
  );
}

/** Submits a still image ad with its text lines laid out on it (see imagePrompt). */
export async function submitImage(brief: ImageBrief, opts: SubmitOptions) {
  return submit(
    TEXT_TO_IMAGE,
    {
      prompt: imagePrompt(brief).slice(0, 2048),
      aspect_ratio: brief.aspect_ratio,
      rendering_speed: "QUALITY", // slower, but text comes out cleaner
    },
    opts,
  );
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
