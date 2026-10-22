import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// Narration for Migz videos. The video model (Kling) doesn't voice a narrator, so the voiceover is spoken
// by ElevenLabs and laid over the finished video with ffmpeg: the narrator on top, the scene's own sound
// kept quietly underneath, nobody on screen speaking.

const run = promisify(execFile);

/** ElevenLabs voice. Default: a warm, natural American male narrator from their library; ELEVENLABS_VOICE_ID swaps it. */
export const narratorVoiceId = () => process.env.ELEVENLABS_VOICE_ID || "nPczCjzI2devNBz1zQrb";
const NARRATION_MODEL = "eleven_multilingual_v2";
const START_AT_S = 0.3; // a beat of picture before the first word
const END_PADDING_S = 0.4; // the last word finishes before the video does
const MAX_SPEEDUP = 1.25; // faster than this sounds rushed
const SCENE_SOUND = 0.25; // the video's own audio under the voice

/** The voiceover as speech (MP3). */
export async function speak(text: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${narratorVoiceId()}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: NARRATION_MODEL,
      // Steady and warm rather than dramatic: a narrator, not an announcer
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ffmpegPath() {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
    return (typeof mod === "string" ? mod : mod.default) ?? null;
  } catch {
    return null;
  }
}

/** Duration in seconds and whether there's an audio track, read from ffmpeg's own report. */
async function probe(bin: string, file: string) {
  let report = "";
  try {
    await run(bin, ["-hide_banner", "-i", file], { timeout: 20_000 });
  } catch (e) {
    report = String((e as { stderr?: string }).stderr ?? ""); // ffmpeg with no output exits non-zero; the report is on stderr
  }
  const m = report.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  return { seconds, hasAudio: /Stream #\S+.*Audio:/.test(report) };
}

/**
 * The video with the narration laid on top: voice levelled and started a beat in, sped up a little if it
 * would overrun (never past MAX_SPEEDUP; past that it's cut at the end), the scene's own sound kept low.
 * The picture is copied untouched. Null when ffmpeg isn't available here.
 */
export async function mixNarration(video: Buffer, voice: Buffer): Promise<Buffer | null> {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "migz-voice-"));
  try {
    const vIn = join(dir, "video.mp4");
    const aIn = join(dir, "voice.mp3");
    const out = join(dir, "out.mp4");
    await writeFile(vIn, video);
    await writeFile(aIn, voice);
    const [v, a] = await Promise.all([probe(bin, vIn), probe(bin, aIn)]);
    if (!v.seconds) throw new Error("Couldn't read the video's length");
    const room = Math.max(1, v.seconds - START_AT_S - END_PADDING_S);
    const tempo = a.seconds && a.seconds > room ? Math.min(MAX_SPEEDUP, a.seconds / room) : 1;
    const delayMs = Math.round(START_AT_S * 1000);
    const voiceChain = `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,atempo=${tempo.toFixed(3)},adelay=${delayMs}|${delayMs}`;
    const filter = v.hasAudio
      ? `${voiceChain}[vo];[0:a]volume=${SCENE_SOUND}[bg];[bg][vo]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`
      : `${voiceChain},apad[a]`;
    await run(
      bin,
      ["-loglevel", "error", "-y", "-i", vIn, "-i", aIn, "-filter_complex", filter, "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-t", v.seconds.toFixed(3), "-movflags", "+faststart", out],
      { timeout: 120_000 },
    );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Speaks the voiceover and lays it over the video. Throws with the reason when it can't (the caller decides). */
export async function narrateVideo(video: Buffer, voiceover: string): Promise<Buffer> {
  const voice = await speak(voiceover);
  const mixed = await mixNarration(video, voice);
  if (!mixed) throw new Error("ffmpeg isn't available here");
  return mixed;
}
