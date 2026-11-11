import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callModel, defaultCreateMessage, jsonOf } from "@/lib/migz/router";
import { composeMusic, ffmpegPath, probe } from "@/lib/migz/narration";
import { transcribe } from "@/lib/migz/presenter-edit";
import type { PresenterPlan } from "@/lib/migz/presenter-plan";
import { getPresenter, onCameraLine } from "@/lib/migz/presenter";
import { brandForEdit, googleFontFiles } from "@/lib/edit/brand-scan";
import { buildPlan, H, W, type Box, type EditPlan, type SfxKind } from "@/lib/edit/plan";
import { fixPlan, type Check } from "@/lib/edit/qc";
import { buildComposition } from "@/lib/edit/composition";

// Hands an edit to the render worker: the talking video transcribed, the face found, the plan built and checked,
// the HyperFrames page written, and the media signed for the worker to download. The worker uploads the finished
// file and calls back (src/app/api/webhooks/render).

const run = promisify(execFile);
export const EDIT_TIMEOUT_MS = 45 * 60_000; // after this, the simple edit takes over

export type EditState = { status: "rendering" | "done" | "failed"; started_at: string; plan_checks?: Check[]; render_checks?: Check[]; stats?: unknown; error?: string; seconds?: number };

export const editWorkerReady = () => !!process.env.RENDER_WORKER_URL?.trim() && !!process.env.RENDER_WORKER_SECRET?.trim();

export const signRender = (body: string) => createHmac("sha256", process.env.RENDER_WORKER_SECRET ?? "").update(body).digest("hex");
export function validRenderSignature(body: string, signature: string) {
  const a = Buffer.from(signRender(body));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const editPath = (jobId: string, file: string) => `edits/${jobId}/${file}`;

async function sign(path: string) {
  const { data } = await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 6 * 3600);
  if (!data) throw new Error(`Couldn't sign ${path}`);
  return data.signedUrl;
}

/** Where the face is in the 9:16 frame, from one frame of the talking video (a small vision call). */
async function findFace(frame: Buffer, agentId: string): Promise<Box | null> {
  const res = await callModel({
    task: "creative_traits",
    tier: "haiku",
    agentId,
    runId: null,
    createMessage: defaultCreateMessage,
    params: {
      max_tokens: 2000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: { type: "object", additionalProperties: false, required: ["found", "left", "top", "right", "bottom"], properties: { found: { type: "boolean" }, left: { type: "number" }, top: { type: "number" }, right: { type: "number" }, bottom: { type: "number" } } },
        },
      },
      system: "You locate the speaker's face in a vertical video frame. Give the box from the top of the hair to the chin and ear to ear, as fractions of the image width (left, right) and height (top, bottom), 0 to 1.",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame.toString("base64") } }, { type: "text", text: "Where is the face?" }] }],
    },
  });
  const r = jsonOf<{ found: boolean; left: number; top: number; right: number; bottom: number }>(res.message);
  if (!r?.found || r.right <= r.left || r.bottom <= r.top) return null;
  // A little padding: the checks keep text off this box, shadows included
  const pad = 0.03;
  const x = Math.max(0, r.left - pad) * W;
  const y = Math.max(0, r.top - pad) * H;
  return { x, y, w: Math.min(1, r.right + pad) * W - x, h: Math.min(1, r.bottom + pad) * H - y };
}

// Sound effects, made once with ElevenLabs and kept in storage (the worker downloads them by signed URL)
const SFX_PROMPTS: Record<SfxKind, { prompt: string; seconds: number }> = {
  hit: { prompt: "Deep clean cinematic impact, very short, subtle, for the first frame of a premium social video", seconds: 0.8 },
  click: { prompt: "Single sharp clean camera shutter click, very short, crisp", seconds: 0.3 },
  whoosh: { prompt: "Soft airy whoosh, short and smooth, subtle, for a camera zoom in a premium edit", seconds: 0.6 },
  pop: { prompt: "Soft subtle short pop, like a clean UI card appearing on screen", seconds: 0.4 },
  swoosh: { prompt: "Quick smooth swoosh transition, short, clean, not cartoonish", seconds: 0.6 },
  riser: { prompt: "Short tense cinematic riser building for half a second into a reveal, clean", seconds: 0.8 },
};

async function sfxUrl(kind: SfxKind): Promise<string | null> {
  const path = `system/sfx/${kind}.mp3`;
  const have = await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 6 * 3600);
  if (have.data) return have.data.signedUrl;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: SFX_PROMPTS[kind].prompt, duration_seconds: SFX_PROMPTS[kind].seconds, prompt_influence: 0.6 }),
  }).catch(() => null);
  if (!res?.ok) return null;
  await supabaseAdmin.storage.from("creatives").upload(path, Buffer.from(await res.arrayBuffer()), { contentType: "audio/mpeg", upsert: true });
  return sign(path);
}

const MUSIC_PROMPT =
  "Modern, confident, minimal instrumental for a premium local home-improvement brand video: tight light drums, warm bass, clean plucked guitar and soft synth, steady and positive. Restrained, cinematic, not cheesy. No vocals, no lyrics.";

/**
 * Builds the edit for a presenter video and sends it to the worker. Returns the plan checks, or null (with why)
 * when it can't: then the caller uses the simple edit.
 */
export async function startEdit(job: { id: string; agent_id: string }, plan: PresenterPlan, media: { talkingUrl: string | null; broll: string[] }, company: string): Promise<{ started: true; checks: Check[] } | { started: false; reason: string }> {
  const bin = await ffmpegPath();
  if (!bin) return { started: false, reason: "ffmpeg isn't available here" };
  const dir = await mkdtemp(join(tmpdir(), "edit-"));
  try {
    // The talking video, kept where the worker can read it
    let talk: Buffer;
    if (plan.mode === "film") {
      const { data, error } = await supabaseAdmin.storage.from("creatives").download(plan.film_path!);
      if (error || !data) throw new Error("Couldn't read the recording");
      talk = Buffer.from(await data.arrayBuffer());
    } else {
      if (!media.talkingUrl) throw new Error("The talking video is missing");
      const res = await fetch(media.talkingUrl);
      if (!res.ok) throw new Error("Couldn't download the talking video");
      talk = Buffer.from(await res.arrayBuffer());
    }
    const talkFile = join(dir, "talk.mp4");
    await writeFile(talkFile, talk);
    const src = await probe(bin, talkFile);
    if (!src.hasAudio || !src.seconds) throw new Error("The talking video has no sound");
    await supabaseAdmin.storage.from("creatives").upload(editPath(job.id, "talk.mp4"), talk, { contentType: "video/mp4", upsert: true });

    // What was said, and where the face is
    const [words, face] = await Promise.all([
      transcribe(talk),
      (async () => {
        const f = join(dir, "face.jpg");
        await run(bin, ["-loglevel", "error", "-y", "-ss", String(Math.min(1, src.seconds! / 2)), "-i", talkFile, "-frames:v", "1", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},scale=540:960`, "-q:v", "4", f], { timeout: 30_000 });
        return findFace(await readFile(f), job.agent_id).catch(() => null);
      })(),
    ]);
    if (words.length < 8) return { started: false, reason: "Too little speech to edit" };

    // The brand and the facts the roofer gave
    const { brand, row } = await brandForEdit(job.agent_id);
    const presenter = await getPresenter(job.agent_id);
    const certifications = row?.certifications.length ? row.certifications : plan.badge ? [plan.badge] : [];
    const names = [company, ...plan.towns, ...certifications, ...(onCameraLine(presenter ?? null)?.split(",")[0] ? [onCameraLine(presenter ?? null)!.split(",")[0]] : [])];
    const built = buildPlan({
      words,
      sourceSeconds: src.seconds,
      sourceHeight: Math.min(src.width ?? 1080, src.height ?? 1920) >= 1080 ? 1080 : 720,
      face,
      broll: media.broll.length,
      hook: plan.callout ?? null,
      towns: plan.towns,
      deals: row?.deals.length ? row.deals : plan.offer ? [plan.offer] : [],
      certifications,
      license: row?.license ?? null,
      warranties: row?.warranties ?? [],
      names,
      hasLogo: !!brand.logoUrl,
    });
    const { plan: edit, checks } = fixPlan(built, { face, names, sourceWords: words });
    const failed = checks.filter((c) => !c.pass);
    if (failed.length) return { started: false, reason: `Plan checks failed: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}` };

    // Music, sound effects and fonts
    const kinds = [...new Set(edit.sfx.map((s) => s.kind))];
    const [music, sfx, heading, body] = await Promise.all([
      composeMusic(null, Math.ceil(edit.seconds) + 2, MUSIC_PROMPT).catch(() => null),
      Promise.all(kinds.map(async (k) => [k, await sfxUrl(k).catch(() => null)] as const)),
      googleFontFiles(brand.headingFont),
      brand.bodyFont === brand.headingFont ? Promise.resolve([]) : googleFontFiles(brand.bodyFont),
    ]);
    let musicUrl: string | null = null;
    if (music) {
      await supabaseAdmin.storage.from("creatives").upload(editPath(job.id, "music.mp3"), music, { contentType: "audio/mpeg", upsert: true });
      musicUrl = await sign(editPath(job.id, "music.mp3"));
    }
    const headingFiles = heading.filter((f) => f.weight >= 700);
    const bodyFiles = (brand.bodyFont === brand.headingFont ? heading : body).filter((f) => f.weight === 400 || f.weight === 700);
    const fonts = [...headingFiles.map((f) => ({ file: `heading-${f.weight}.woff2`, url: f.url })), ...bodyFiles.map((f) => ({ file: `body-${f.weight}.woff2`, url: f.url }))];
    const html = buildComposition(edit, brand, { headingWeights: headingFiles.map((f) => f.weight), bodyWeights: bodyFiles.map((f) => f.weight), hasLogo: !!brand.logoUrl, brollCount: edit.broll.length });

    // Where the worker puts the finished file, and where it reports
    const { data: upload, error: upErr } = await supabaseAdmin.storage.from("creatives").createSignedUploadUrl(editPath(job.id, "final.mp4"), { upsert: true });
    if (upErr || !upload) throw new Error(`Couldn't make the upload link: ${upErr?.message}`);
    const base = process.env.APP_URL?.replace(/\/$/, "");
    if (!base) return { started: false, reason: "APP_URL is not set (the worker has nowhere to report)" };
    const payload = {
      jobId: job.id,
      fps: edit.fps,
      seconds: edit.seconds,
      segments: edit.segments,
      html,
      sfx: edit.sfx,
      musicEnd: edit.musicEnd,
      fonts,
      media: {
        talk: await sign(editPath(job.id, "talk.mp4")),
        broll: edit.broll.map((b) => media.broll[b.index] ?? media.broll[0]),
        logo: brand.logoUrl ?? null,
        music: musicUrl,
        sfx: Object.fromEntries(sfx.filter(([, u]) => u)),
      },
      upload: upload.signedUrl,
      callback: `${base}/api/webhooks/render`,
    };
    const res = await fetch(`${process.env.RENDER_WORKER_URL!.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RENDER_WORKER_SECRET}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { started: false, reason: `The render worker refused the job (${res.status})` };
    await supabaseAdmin.storage.from("creatives").upload(editPath(job.id, "plan.json"), Buffer.from(JSON.stringify(edit)), { contentType: "application/json", upsert: true });
    return { started: true, checks };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The finished edit from storage, and its temporary files removed. */
export async function takeFinishedEdit(jobId: string): Promise<Buffer | null> {
  const { data } = await supabaseAdmin.storage.from("creatives").download(editPath(jobId, "final.mp4"));
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function cleanEdit(jobId: string) {
  const { data } = await supabaseAdmin.storage.from("creatives").list(`edits/${jobId}`);
  if (data?.length) await supabaseAdmin.storage.from("creatives").remove(data.map((f) => editPath(jobId, f.name)));
}

export type { EditPlan };
