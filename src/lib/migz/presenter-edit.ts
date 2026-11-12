import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createElement as h } from "react";
import { ImageResponse } from "next/og";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { composeMusic, ffmpegPath, probe } from "@/lib/migz/narration";
import { brollTimes, captions, cardTimes, overlayFilter, sfxEvents, type Caption, type Card, type PresenterPlan, type Sfx, type Word } from "@/lib/migz/presenter-plan";

// Edits the presenter video. The owner talking (their own recording, or HeyGen's lip-synced version of their
// photo) is cropped to 9:16; real job clips cut in; captions and cards are drawn with next/og and laid over with
// ffmpeg; then the sound: their voice levelled, an upbeat music bed ducked under it, and hits, whooshes and pops
// on the edit.

const run = promisify(execFile);
const W = 720;
const H = 1280;
const ORANGE = "#F59E0B";
const RED = "#EF4444";

async function png(node: React.ReactElement) {
  return Buffer.from(await new ImageResponse(node, { width: W, height: H }).arrayBuffer());
}

const frame = (justify: string, children: React.ReactNode) =>
  h("div", { style: { width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: justify, padding: "150px 48px", background: "transparent" } }, children);
const panel = (children: React.ReactNode) =>
  h("div", { style: { display: "flex", flexDirection: "column", background: "rgba(15,20,30,0.86)", borderRadius: 28, padding: "32px 36px", color: "white", maxWidth: 620 } }, children);

function captionImage(c: Caption) {
  const before = c.text.slice(0, c.text.length - c.emphasis.length).trim();
  return png(
    frame(
      "center",
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", textShadow: "0 4px 18px rgba(0,0,0,0.75)", marginTop: 260 } },
        before ? h("div", { style: { color: "white", fontSize: 60, lineHeight: 1.05, WebkitTextStroke: "1.5px white" } }, before) : null,
        h("div", { style: { color: ORANGE, fontSize: 84, lineHeight: 1.05, WebkitTextStroke: `2.5px ${ORANGE}` } }, c.emphasis),
      ),
    ),
  );
}

function cardImage(card: Card, plan: PresenterPlan) {
  if (card.kind === "callout")
    return png(frame("flex-start", h("div", { style: { display: "flex", background: RED, color: "white", fontSize: 58, padding: "16px 34px", borderRadius: 18, textTransform: "uppercase", letterSpacing: 1, WebkitTextStroke: "2px white", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" } }, plan.callout!)));
  if (card.kind === "towns")
    return png(frame("flex-start", h("div", { style: { display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start", width: "100%", marginTop: 240 } }, ...plan.towns.slice(0, 3).map((t) => h("div", { key: t, style: { display: "flex", background: "rgba(15,20,30,0.82)", color: "white", fontSize: 44, padding: "10px 26px", borderRadius: 16, borderLeft: `10px solid ${RED}` } }, t)))));
  if (card.kind === "offer")
    return png(frame("flex-end", h("div", { style: { display: "flex", background: ORANGE, color: "#111827", fontSize: 52, padding: "20px 42px", borderRadius: 999, WebkitTextStroke: "1.5px #111827", textAlign: "center" } }, plan.offer!)));
  if (card.kind === "badge")
    return png(
      frame(
        "flex-end",
        panel([
          h("div", { key: "a", style: { display: "flex", fontSize: 26, color: "#CBD5E1", letterSpacing: 2 } }, "CERTIFIED"),
          h("div", { key: "b", style: { display: "flex", fontSize: 46, marginTop: 6, WebkitTextStroke: "1px white" } }, plan.badge!),
        ]),
      ),
    );
  return png(
    frame(
      "flex-end",
      panel([
        h("div", { key: "a", style: { display: "flex", fontSize: 62, color: ORANGE, WebkitTextStroke: `2px ${ORANGE}` } }, "Tap Learn More"),
        h("div", { key: "b", style: { display: "flex", fontSize: 34, marginTop: 8 } }, `to request your ${plan.lead_offer === "free quote" ? "free quote" : "free inspection"}`),
        h("div", { key: "c", style: { display: "flex", fontSize: 26, marginTop: 8, color: "#CBD5E1" } }, "No deposit. No obligation."),
      ]),
    ),
  );
}

// How the script is spoken. Eleven v3 first: it reads the punctuation like a person (a comma is a breath, a dash
// a beat, a question goes up) instead of one even rhythm; "Natural" stability keeps it close to their own voice.
// Multilingual v2 when v3 refuses, with less stability and more style than its default, so it's less sing-song.
const SPEECH = [
  { model_id: "eleven_v3", voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true } },
  { model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.32, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true } },
];

/** The script spoken (their cloned voice first, then the narrators), as MP3. */
export async function speakScript(text: string, voiceIds: string[]): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  let last = "";
  for (const voice of voiceIds) {
    for (const speech of SPEECH) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, ...speech }),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      last = `${speech.model_id} ${res.status}`;
    }
  }
  throw new Error(`ElevenLabs voice failed (${last})`);
}

/** What was said in the talking video, with word times. */
export async function transcribe(video: Buffer): Promise<Word[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", new Blob([new Uint8Array(video)], { type: "video/mp4" }), "talk.mp4");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs transcription ${res.status}`);
  const j = (await res.json()) as { words: { text: string; start: number; end: number; type: string }[] };
  return j.words.filter((w) => w.type === "word").map((w) => ({ word: w.text, start: w.start, end: w.end }));
}

// ---------- Sound effects ----------

const SFX: Record<Sfx["kind"], { prompt: string; seconds: number; volume: number; synth: string[] }> = {
  hit: { prompt: "Deep punchy cinematic impact boom, very short, for the first frame of a social media video", seconds: 0.8, volume: 0.55, synth: ["-f", "lavfi", "-i", "sine=f=55:d=0.7", "-af", "afade=t=out:st=0.05:d=0.65,volume=3"] },
  whoosh: { prompt: "Fast clean swoosh transition, short and crisp, for a social media video edit", seconds: 0.6, volume: 0.4, synth: ["-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.8", "-af", "bandpass=f=1800:width_type=h:w=1500,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.3"] },
  pop: { prompt: "Soft subtle short pop, like a caption appearing on screen", seconds: 0.5, volume: 0.22, synth: ["-f", "lavfi", "-i", "sine=f=1200:d=0.06", "-af", "afade=t=out:st=0.01:d=0.05"] },
};

/** One sound effect as a file: made once with ElevenLabs and kept in storage, or synthesized when that fails. */
async function sfxFile(bin: string, dir: string, kind: Sfx["kind"]) {
  const path = `system/sfx/${kind}.mp3`;
  const file = join(dir, `sfx-${kind}.mp3`);
  const cached = await supabaseAdmin.storage.from("creatives").download(path);
  if (cached.data) {
    await writeFile(file, Buffer.from(await cached.data.arrayBuffer()));
    return file;
  }
  const key = process.env.ELEVENLABS_API_KEY;
  if (key) {
    const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: SFX[kind].prompt, duration_seconds: SFX[kind].seconds, prompt_influence: 0.6 }),
    }).catch(() => null);
    if (res?.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      await writeFile(file, bytes);
      await supabaseAdmin.storage.from("creatives").upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
      return file;
    }
  }
  const wav = join(dir, `sfx-${kind}.wav`);
  await run(bin, ["-loglevel", "error", "-y", ...SFX[kind].synth, wav], { timeout: 20_000 });
  return wav;
}

const MUSIC_PROMPT =
  "Modern upbeat, confident instrumental for a local home-improvement company's social media ad: punchy light drums, bright guitar and synth, steady driving rhythm, positive and trustworthy. No vocals, no lyrics.";

/** Their voice levelled, the music ducked under it, and the sound effects on the edit. The picture is copied. */
async function mixSound(bin: string, dir: string, video: string, seconds: number, events: Sfx[]) {
  const music = await composeMusic(null, Math.ceil(seconds) + 2, MUSIC_PROMPT).catch(() => null);
  const inputs = ["-i", video];
  const fmt = "aformat=sample_rates=44100:channel_layouts=stereo";
  const chains = [`[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,${fmt},asplit=2[voice][key]`];
  const mixIn = ["[voice]"];
  let next = 1;
  if (music) {
    const m = join(dir, "music.mp3");
    await writeFile(m, music);
    inputs.push("-stream_loop", "-1", "-i", m);
    chains.push(`[${next}:a]atrim=duration=${seconds.toFixed(2)},loudnorm=I=-24:TP=-2,${fmt},afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, seconds - 1).toFixed(2)}:d=1[bed]`, `[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[music]`);
    mixIn.push("[music]");
    next++;
  } else chains.push("[key]anullsink");
  for (const kind of ["hit", "whoosh", "pop"] as const) {
    const at = events.filter((e) => e.kind === kind && e.at < seconds - 0.1);
    if (!at.length) continue;
    inputs.push("-i", await sfxFile(bin, dir, kind));
    const labels = at.map((_, i) => `[${kind}${i}]`);
    chains.push(`[${next}:a]${fmt},volume=${SFX[kind].volume}${at.length > 1 ? `,asplit=${at.length}` : ""}${labels.join("")}`);
    at.forEach((e, i) => {
      const ms = Math.round(e.at * 1000);
      chains.push(`${labels[i]}adelay=${ms}|${ms}[${kind}d${i}]`);
      mixIn.push(`[${kind}d${i}]`);
    });
    next++;
  }
  chains.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first,alimiter=limit=0.95[a]`);
  const out = join(dir, "final.mp4");
  await run(bin, ["-loglevel", "error", "-y", ...inputs, "-filter_complex", chains.join(";"), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", seconds.toFixed(2), "-movflags", "+faststart", out], { timeout: 180_000 });
  return readFile(out);
}

const crop = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p`;

/** The finished presenter video: the talking video (HeyGen's URL, or their recording for film), b-roll clip URLs. */
export async function assemblePresenter(plan: PresenterPlan, media: { talkingUrl: string | null; broll: string[] }): Promise<Buffer> {
  const bin = await ffmpegPath();
  if (!bin) throw new Error("ffmpeg isn't available here");
  const dir = await mkdtemp(join(tmpdir(), "presenter-"));
  try {
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
    const input = join(dir, "talk.mp4");
    await writeFile(input, talk);
    if (!(await probe(bin, input)).hasAudio) throw new Error("The talking video has no sound");
    const base = join(dir, "base.mp4");
    await run(bin, ["-loglevel", "error", "-y", "-i", input, "-t", "60", "-vf", crop, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", base], { timeout: 180_000 });
    const words = await transcribe(talk);

    const seconds = (await probe(bin, base)).seconds ?? 0;
    if (!seconds) throw new Error("The edited video came out empty");
    const caps = captions(words);
    const cards = cardTimes(seconds, plan);
    const cuts = brollTimes(seconds, media.broll.length);
    // Captions step aside for the last card
    const cta = cards.find((k) => k.kind === "cta")!;
    const shown = caps.filter((c) => c.start < cta.start);

    // Job clips cut in over the owner (their voice keeps going), then captions and cards on top
    const inputs: string[] = [];
    const chains: string[] = [];
    let from = "0:v";
    for (const [i, t] of cuts.entries()) {
      const res = await fetch(media.broll[i]);
      if (!res.ok) throw new Error(`Couldn't download job clip ${i + 1}`);
      const f = join(dir, `b${i}.mp4`);
      await writeFile(f, Buffer.from(await res.arrayBuffer()));
      inputs.push("-i", f);
      chains.push(`[${i + 1}:v]${crop},trim=duration=${(t.end - t.start).toFixed(2)},setpts=PTS-STARTPTS+${t.start.toFixed(2)}/TB[b${i}]`);
      chains.push(`[${from}][b${i}]overlay=0:0:eof_action=pass:enable='between(t,${t.start.toFixed(2)},${t.end.toFixed(2)})'[cut${i}]`);
      from = `cut${i}`;
    }
    const images = await Promise.all([...shown.map(captionImage), ...cards.map((k) => cardImage(k, plan))]);
    for (const [i, img] of images.entries()) {
      const f = join(dir, `o${i}.png`);
      await writeFile(f, img);
      inputs.push("-i", f);
    }
    const over = overlayFilter([...shown, ...cards], from, cuts.length + 1);
    chains.push(over.filter);
    const edited = join(dir, "edited.mp4");
    await run(bin, ["-loglevel", "error", "-y", "-i", base, ...inputs, "-filter_complex", chains.filter(Boolean).join(";"), "-map", over.out, "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "copy", edited], { timeout: 240_000 });

    return await mixSound(bin, dir, edited, seconds, sfxEvents(cards, shown, cuts));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
