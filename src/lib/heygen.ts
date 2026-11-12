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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "x-api-key": key(), "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.text();
  if (!res.ok) throw new Error(`HeyGen ${res.status}: ${body.slice(0, 300)}`);
  return ((JSON.parse(body) as { data?: T }).data ?? (JSON.parse(body) as T)) as T;
}

type AvatarCreated = { avatar_item?: { id: string; group_id: string; status?: string; preview_image_url?: string | null }; avatar_group?: { id: string } };
export type Look = { id: string; group_id: string; status: "processing" | "completed" | "failed" | string; preview_image_url: string | null };

/** The owner's photo as a HeyGen photo avatar (the identity every jobsite look is made from). */
export async function createPhotoAvatar(input: { name: string; imageUrl: string }) {
  const d = await call<AvatarCreated>("/v3/avatars", { method: "POST", body: JSON.stringify({ type: "photo", name: input.name.slice(0, 80), file: { type: "url", url: input.imageUrl } }) });
  if (!d.avatar_item?.id) throw new Error("HeyGen didn't return the photo avatar");
  return { avatarId: d.avatar_item.id, groupId: d.avatar_item.group_id ?? d.avatar_group?.id ?? "" };
}

/**
 * A new look of the same person from a prompt (a 9:16 still of them at a jobsite): the face comes from their photo
 * avatar and the reference photo; the scene, clothes and pose from the prompt.
 */
export async function createLook(input: { name: string; prompt: string; avatarId: string; groupId: string; referenceUrl: string }) {
  const d = await call<AvatarCreated>("/v3/avatars", {
    method: "POST",
    body: JSON.stringify({
      type: "prompt",
      name: input.name.slice(0, 80),
      prompt: input.prompt.slice(0, 1000),
      reference_images: [{ type: "url", url: input.referenceUrl }],
      avatar_id: input.avatarId,
      avatar_group_id: input.groupId,
      aspect_ratio: "9:16",
    }),
  });
  if (!d.avatar_item?.id) throw new Error("HeyGen didn't return the new look");
  return d.avatar_item.id;
}

export async function getLook(lookId: string): Promise<Look> {
  const d = await call<Look>(`/v3/avatars/looks/${encodeURIComponent(lookId)}`);
  return { id: d.id ?? lookId, group_id: d.group_id, status: d.status ?? "processing", preview_image_url: d.preview_image_url ?? null };
}

/** The jobsite look speaking our audio, lips matched, with natural gestures (Avatar IV). */
export async function submitLookVideo(input: { lookId: string; audioUrl: string; title: string; motion?: string }) {
  const d = await call<{ video_id?: string }>("/v3/videos", {
    method: "POST",
    body: JSON.stringify({
      type: "avatar",
      avatar_id: input.lookId,
      audio_url: input.audioUrl,
      title: input.title.slice(0, 100),
      engine: { type: "avatar_iv" },
      aspect_ratio: "9:16",
      resolution: "1080p",
      fit: "cover",
      expressiveness: "medium",
      motion_prompt: input.motion ?? "A local roofing company owner talking to the camera on a jobsite: confident and friendly, natural head movement, relaxed open-hand gestures while holding a tablet, small weight shifts. No exaggerated movement.",
    }),
  });
  if (!d.video_id) throw new Error("HeyGen didn't return a video id");
  return d.video_id;
}

/** What the jobsite look is asked for: the person, waist up, at a real job, in their company's colours. Pure. */
export function jobsitePrompt(input: { company: string; town: string | null; shirtColor?: string | null; looks?: string | null }) {
  return [
    `The same person as the reference photo: keep their exact face shape, hairstyle, hair length and texture, facial hair, skin tone and build${input.looks ? ` (${input.looks})` : ""}. They must be instantly recognizable as the person in the photo.`,
    `A vertical 9:16 photo of them standing outdoors on a residential driveway at a roofing jobsite${input.town ? ` in ${input.town}` : ""}, facing the camera, framed from the waist up with their head in the upper third, holding a tablet in one hand at chest height.`,
    `They wear a plain ${input.shirtColor || "charcoal grey"} zip-up work hoodie with no text, no logos, no patches and no labels, over a dark t-shirt.`,
    "Behind them, softly out of focus: a two-story suburban house with ladders against it and a roofing crew working on the roof, a work truck parked at the side, evergreen trees, overcast sky.",
    "Shot on a cinema camera with an 85mm lens, shallow depth of field, natural moody overcast light, realistic skin texture, true-to-life colour. No text, no watermark, no brand marks anywhere.",
  ].join(" ");
}

export type HeygenStatus ={ status: "pending" | "processing" | "completed" | "failed"; videoUrl: string | null; error: string | null };

export async function getTalkingPhoto(videoId: string): Promise<HeygenStatus> {
  const res = await fetch(`${BASE}/v3/videos/${encodeURIComponent(videoId)}`, { headers: { "x-api-key": key() } });
  if (!res.ok) throw new Error(`HeyGen status ${res.status}`);
  const d = ((await res.json()) as { data?: { status?: HeygenStatus["status"]; video_url?: string; failure_message?: string } }).data ?? {};
  return { status: d.status ?? "pending", videoUrl: d.video_url ?? null, error: d.failure_message ?? null };
}
