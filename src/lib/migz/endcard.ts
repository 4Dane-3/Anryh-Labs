import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ffmpegPath, probe } from "@/lib/migz/narration";

// The end card on a finished video: over its last seconds the scene keeps playing but softens into a blur
// and zooms out, and the agent's logo fades in on top. The logo is added here, not asked of the video
// model, because models garble logos and lettering.

const run = promisify(execFile);

/** Seconds of the video the effect takes, counted back from the end. */
export const END_CARD_SECONDS = 3;
const MIN_VIDEO_SECONDS = 6; // shorter than this there's no scene left to zoom out of
const SHRINK_SECONDS = 2; // the scene pulls back over this long
const SHRINK_TO = 0.82; // and ends at this share of the frame
const SCENE_FADE_FROM = 0.5; // it starts dissolving into the blur this far into the window
const SCENE_FADE_SECONDS = 1.4;
const LOGO_FADE_FROM = 1.2; // the logo comes in as the scene dissolves
const LOGO_FADE_SECONDS = 0.8;
const BLUR_SIGMA = 36;
const CARD_WIDTH = 0.64; // the logo card's width, as a share of the frame's
const CARD_CORNER = 0.06; // its corner radius, as a share of its width

const even = (n: number) => 2 * Math.round(n / 2);
const num = (n: number) => n.toFixed(3);

/**
 * The ffmpeg filter graph for a video `seconds` long and `width` x `height`, with the logo as input 1.
 * Pure, so the timings are testable. Output pad: [v].
 */
export function endCardFilter(seconds: number, width: number, height: number) {
  const t0 = seconds - END_CARD_SECONDS;
  const cardW = even(width * CARD_WIDTH);
  // How far into the pull-back the scene is, 0 to 1, easing out
  const p = `(1-pow(1-clip((t-${num(t0)})/${SHRINK_SECONDS},0,1),2))`;
  return [
    "[0:v]split=2[fg0][bg0]",
    // The same scene, blurred, fills the frame behind the shrinking one
    `[bg0]scale=${width}:${height},gblur=sigma=${BLUR_SIGMA}:steps=2[bg]`,
    `[fg0]format=yuva420p,fade=t=out:st=${num(t0 + SCENE_FADE_FROM)}:d=${SCENE_FADE_SECONDS}:alpha=1,` +
      `scale=w='2*trunc(${width}*(1-${num(1 - SHRINK_TO)}*${p})/2)':h='2*trunc(${height}*(1-${num(1 - SHRINK_TO)}*${p})/2)':eval=frame[fg]`,
    "[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame[base]",
    `[1:v]scale=${cardW}:${cardW},format=yuva420p,fade=t=in:st=${num(t0 + LOGO_FADE_FROM)}:d=${LOGO_FADE_SECONDS}:alpha=1[logo]`,
    "[base][logo]overlay=x='(W-w)/2':y='(H-h)/2'[v]",
  ].join(";");
}

/**
 * The logo (input 0) as a white square card with rounded corners, scaled to the card's size. A logo with a
 * transparent background is laid on the white, so the dark lettering is always readable over the blurred
 * scene; one with a solid background just sits on it. Output pad: [card].
 */
export function cardFilter(cardW: number) {
  const r = Math.round(cardW * CARD_CORNER);
  const half = cardW / 2;
  const inside = `lte(hypot(max(abs(X-${half})-${half - r},0),max(abs(Y-${half})-${half - r},0)),${r})`;
  return [
    `color=c=white:s=${cardW}x${cardW}:d=1[white]`,
    `[0:v]scale=${cardW}:${cardW}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba[logo]`,
    `[white][logo]overlay=x='(W-w)/2':y='(H-h)/2':format=auto,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(${inside},255,0)'[card]`,
  ].join(";");
}

/**
 * The video with the end card on its last seconds. The sound is copied untouched. Returns the video
 * unchanged when it's too short for the effect, and null when ffmpeg isn't available here.
 */
export async function addEndCard(video: Buffer, logo: Buffer): Promise<Buffer | null> {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "endcard-"));
  try {
    const vIn = join(dir, "in.mp4");
    const lIn = join(dir, "logo");
    const card = join(dir, "card.png");
    const out = join(dir, "out.mp4");
    await Promise.all([writeFile(vIn, video), writeFile(lIn, logo)]);
    const v = await probe(bin, vIn);
    if (!v.seconds || !v.width || !v.height) throw new Error("Couldn't read the video's length and size");
    if (v.seconds < MIN_VIDEO_SECONDS) return video;
    const width = even(v.width);
    const height = even(v.height);
    const cardW = even(width * CARD_WIDTH);

    await run(bin, ["-loglevel", "error", "-y", "-i", lIn, "-filter_complex", cardFilter(cardW), "-map", "[card]", "-frames:v", "1", card], { timeout: 30_000 });
    await run(
      bin,
      [
        "-loglevel", "error", "-y",
        "-i", vIn,
        "-loop", "1", "-framerate", "30", "-t", num(v.seconds), "-i", card,
        "-filter_complex", endCardFilter(v.seconds, width, height),
        "-map", "[v]", ...(v.hasAudio ? ["-map", "0:a"] : []),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        ...(v.hasAudio ? ["-c:a", "copy"] : []),
        "-t", num(v.seconds), "-movflags", "+faststart", out,
      ],
      { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
