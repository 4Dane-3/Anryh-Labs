import "server-only";

// HeyGen: the owner's own photo speaking our audio, lips matched (POST /v3/videos, type "image"). Used only for
// the "AI version of you" presenter; every other video is made with Higgsfield.

const BASE = "https://api.heygen.com";

export const heygenReady = () => !!process.env.HEYGEN_API_KEY?.trim();

function key() {
  const k = process.env.HEYGEN_API_KEY?.trim();
  if (!k) throw new Error("HEYGEN_API_KEY is not set");
  return k;
}

/** Starts a talking video from a photo and an audio file (both public URLs). Returns HeyGen's video id. */
export async function submitTalkingPhoto(input: { imageUrl: string; audioUrl: string; title: string; motion?: string }) {
  const res = await fetch(`${BASE}/v3/videos`, {
    method: "POST",
    headers: { "x-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "image",
      image: { type: "url", url: input.imageUrl },
      audio_url: input.audioUrl,
      title: input.title.slice(0, 100),
      aspect_ratio: "9:16",
      resolution: "720p",
      fit: "cover",
      expressiveness: "medium",
      motion_prompt: input.motion ?? "Talks warmly and confidently to the camera like a local business owner, natural small head movements and hand gestures.",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HeyGen ${res.status}: ${body.slice(0, 300)}`);
  const id = (JSON.parse(body) as { data?: { video_id?: string } }).data?.video_id;
  if (!id) throw new Error("HeyGen didn't return a video id");
  return id;
}

export type HeygenStatus = { status: "pending" | "processing" | "completed" | "failed"; videoUrl: string | null; error: string | null };

export async function getTalkingPhoto(videoId: string): Promise<HeygenStatus> {
  const res = await fetch(`${BASE}/v3/videos/${encodeURIComponent(videoId)}`, { headers: { "x-api-key": key() } });
  if (!res.ok) throw new Error(`HeyGen status ${res.status}`);
  const d = ((await res.json()) as { data?: { status?: HeygenStatus["status"]; video_url?: string; failure_message?: string } }).data ?? {};
  return { status: d.status ?? "pending", videoUrl: d.video_url ?? null, error: d.failure_message ?? null };
}
