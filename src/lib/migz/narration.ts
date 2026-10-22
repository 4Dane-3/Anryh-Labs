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

export type Narrator = "female" | "male";

// Narrators from the ElevenLabs Voice Library, chosen by Anryh Labs (env vars swap either one):
//  - female: Vivie, "Powerful and Commanding" (middle-aged, American, narrative)
//  - male: Mark, "Deep, Serious" (older, American, narrative)
// Library voices can be withdrawn by their owners, so there's a built-in fallback from ElevenLabs' own set.
const VOICES: Record<Narrator, () => string> = {
  female: () => process.env.ELEVENLABS_VOICE_FEMALE || "z7U1SjrEq4fDDDriOQEN",
  male: () => process.env.ELEVENLABS_VOICE_MALE || "GU8Qu28KNb4JbhQV7DX7",
};
const FALLBACK_VOICE = "nPczCjzI2devNBz1zQrb"; // ElevenLabs' own warm American narrator

/** The voices to try for a narrator, in order: theirs, the other narrator, then the built-in fallback. */
export function narratorVoices(narrator: Narrator = "female") {
  const other: Narrator = narrator === "female" ? "male" : "female";
  return [...new Set([VOICES[narrator](), VOICES[other](), FALLBACK_VOICE])];
}
const NARRATION_MODEL = "eleven_multilingual_v2";
const START_AT_S = 0.3; // a beat of picture before the first word
const END_PADDING_S = 0.4; // the last word finishes before the video does
const MAX_SPEEDUP = 1.25; // faster than this sounds rushed
// The scene's own sound (Higgsfield's ambience) usually comes back very quiet: it's measured and brought up
// to a steady, audible level, then turned down only while the narrator speaks (ducking), so it's still there
// before the first word and after the last.
const SCENE_LUFS = -30; // well under the voice (-16), clearly audible on its own
const MAX_SCENE_BOOST_DB = 30;
// The music bed sits under the voice (and is ducked further while it speaks), and fills the ending
const MUSIC_LUFS = -24;
const MUSIC_COMPOSE_S = 22;
const MUSIC_FADE_IN_S = 0.8;
const MUSIC_FADE_OUT_S = 1;
// Once the narrator finishes, the music carries the ending: its own loudness over that stretch is measured
// (every composition differs) and lifted to this level
const MUSIC_TAIL_LUFS = -22;
const MAX_MUSIC_LIFT_DB = 15;

/** The voiceover as speech (MP3), in the narrator's voice (or the next voice that works). */
export async function speak(text: string, narrator: Narrator = "female"): Promise<{ audio: Buffer; voiceId: string }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  let lastError = "";
  for (const voiceId of narratorVoices(narrator)) {
    const res = await speakAs(key, voiceId, text);
    if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), voiceId };
    lastError = `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`;
    // Only a missing or unusable voice moves on to the next one; anything else (key, quota) won't get better
    if (res.status !== 404 && !/voice/i.test(lastError)) break;
  }
  throw new Error(lastError);
}

function speakAs(key: string, voiceId: string, text: string) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: NARRATION_MODEL,
      // Steady and warm rather than dramatic: a narrator, not an announcer
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
}

/**
 * A short instrumental bed for the video (ElevenLabs Music): soft strings and piano that start quietly
 * and swell toward the end, so the closing seconds after the narrator aren't empty.
 */
export async function composeMusic(mood: string | null | undefined, seconds: number): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const prompt = [
    "Gentle, hopeful cinematic instrumental for a heartfelt family ad: soft strings (violins and cello) with warm piano.",
    "Starts very soft, builds slowly, and grows into a full, warm swell through the middle and second half.",
    "Slow tempo. No drums, no percussion, no vocals, no lyrics.",
    mood ? `Mood: ${mood}.` : "",
  ].filter(Boolean).join(" ");
  const res = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ prompt, music_length_ms: Math.round(Math.max(10, Math.min(30, seconds)) * 1000) }),
  });
  if (!res.ok) throw new Error(`ElevenLabs music ${res.status}: ${(await res.text()).slice(0, 300)}`);
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

/** Integrated loudness (LUFS) of a file's audio, or null if it has none or is silent. */
async function loudness(bin: string, file: string, from?: { start: number; seconds: number }) {
  let report = "";
  const window = from ? ["-ss", from.start.toFixed(2), "-t", from.seconds.toFixed(2)] : [];
  try {
    const r = await run(bin, ["-hide_banner", "-nostats", ...window, "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"], { timeout: 60_000 });
    report = String(r.stderr ?? "");
  } catch (e) {
    report = String((e as { stderr?: string }).stderr ?? "");
  }
  const m = [...report.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const lufs = m ? Number(m[1]) : null;
  return lufs !== null && lufs > -70 ? lufs : null;
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
export async function mixNarration(video: Buffer, voice: Buffer, music?: Buffer | null): Promise<Buffer | null> {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "migz-voice-"));
  try {
    const vIn = join(dir, "video.mp4");
    const aIn = join(dir, "voice.mp3");
    const out = join(dir, "out.mp4");
    const mIn = join(dir, "music.mp3");
    await writeFile(vIn, video);
    await writeFile(aIn, voice);
    if (music) await writeFile(mIn, music);
    const [v, a] = await Promise.all([probe(bin, vIn), probe(bin, aIn)]);
    if (!v.seconds) throw new Error("Couldn't read the video's length");
    const room = Math.max(1, v.seconds - START_AT_S - END_PADDING_S);
    const tempo = a.seconds && a.seconds > room ? Math.min(MAX_SPEEDUP, a.seconds / room) : 1;
    const delayMs = Math.round(START_AT_S * 1000);
    const fmt = "aformat=sample_rates=44100:channel_layouts=stereo";
    const voiceChain = `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,atempo=${tempo.toFixed(3)},adelay=${delayMs}|${delayMs},${fmt}`;
    const sceneLufs = v.hasAudio ? await loudness(bin, vIn) : null;
    const boost = sceneLufs === null ? 0 : Math.min(MAX_SCENE_BOOST_DB, SCENE_LUFS - sceneLufs);
    const musicLufs = music ? await loudness(bin, mIn) : null;
    const musicGain = musicLufs === null ? 0 : MUSIC_LUFS - musicLufs;
    const withMusic = !!music && musicLufs !== null;
    // The voice drives a compressor on each bed: down while it speaks, back up in the gaps. Keys are padded
    // with silence (a compressor stops when its sidechain does, which would cut the bed at the last word).
    const keys = 1 + (v.hasAudio ? 1 : 0) + (withMusic ? 1 : 0);
    const parts = [`${voiceChain},asplit=${keys}[vo]${v.hasAudio ? "[ks]" : ""}${withMusic ? "[km]" : ""}`];
    const mixIn = ["[vo]"];
    if (v.hasAudio) {
      parts.push(`[ks]apad[kscene]`, `[0:a]${fmt},volume=${boost.toFixed(1)}dB[scene]`, `[scene][kscene]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[bg]`);
      mixIn.unshift("[bg]"); // the scene runs the full length, so it goes first (amix duration=first)
    }
    if (withMusic) {
      const fadeOutAt = Math.max(0, v.seconds - MUSIC_FADE_OUT_S);
      const voiceEnd = START_AT_S + (a.seconds ?? room) / tempo + 0.3; // a beat after the last word
      // Measured over the last two seconds before the fade: compositions often decay there, and that's the
      // stretch that sounds empty (the part right after the voice is usually louder already)
      const tailStart = Math.max(voiceEnd, fadeOutAt - 2);
      const tailSeconds = Math.max(0, fadeOutAt - tailStart);
      const tailLufs = tailSeconds >= 0.5 ? await loudness(bin, mIn, { start: tailStart, seconds: tailSeconds }) : null;
      const lift = tailLufs === null ? 0 : Math.max(0, Math.min(MAX_MUSIC_LIFT_DB, MUSIC_TAIL_LUFS - (tailLufs + musicGain)));
      parts.push(
        `[km]apad[kmusic]`,
        `[2:a]${fmt},volume=${musicGain.toFixed(1)}dB,volume=${lift.toFixed(1)}dB:enable='gte(t,${voiceEnd.toFixed(2)})',afade=t=in:st=0:d=${MUSIC_FADE_IN_S},afade=t=out:st=${fadeOutAt.toFixed(2)}:d=${MUSIC_FADE_OUT_S},apad[music]`,
        `[music][kmusic]sidechaincompress=threshold=0.02:ratio=4:attack=40:release=900[bed]`,
      );
      mixIn.push("[bed]");
    }
    const filter = mixIn.length > 1
      ? `${parts.join(";")};${mixIn.join("")}amix=inputs=${mixIn.length}:duration=${v.hasAudio ? "first" : "longest"}:normalize=0,alimiter=limit=0.95[a]`
      : `${voiceChain},apad[a]`;
    await run(
      bin,
      ["-loglevel", "error", "-y", "-i", vIn, "-i", aIn, ...(withMusic ? ["-i", mIn] : []), "-filter_complex", filter, "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-t", v.seconds.toFixed(3), "-movflags", "+faststart", out],
      { timeout: 120_000 },
    );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Speaks the voiceover and lays it over the video. Throws with the reason when it can't (the caller decides). */
export async function narrateVideo(
  video: Buffer,
  voiceover: string,
  narrator: Narrator = "female",
  mood?: string | null,
): Promise<Buffer> {
  // Voice and music in parallel; the music is a nice-to-have, so its failure never costs the narration
  const [{ audio }, music] = await Promise.all([
    speak(voiceover, narrator),
    // Composed longer than the video so its own ending falls after the video's: the video's last seconds
    // land mid-swell and our fade closes it (a 15s piece tends to wind down early)
    composeMusic(mood, MUSIC_COMPOSE_S).catch((e) => {
      console.error("music bed failed; narrating without it", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  const mixed = await mixNarration(video, audio, music);
  if (!mixed) throw new Error("ffmpeg isn't available here");
  return mixed;
}
