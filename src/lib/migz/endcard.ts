import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ffmpegPath, probe } from "@/lib/migz/narration";

// The agent's logo on Migz creatives (it's added here, not asked of the image or video model, because
// models garble logos and lettering). The logo is a transparent PNG, and it appears two ways:
//  - a small corner mark on every video and image, with a soft white glow so it reads over dark and light
//  - on videos, an end card: over the last seconds the scene keeps playing but dissolves into a frosted
//    blur and pulls back, and the logo fades in large on it (the corner mark hands over to it)

const run = promisify(execFile);

export const LOGO_CORNERS = ["top_left", "top_right", "bottom_left", "bottom_right"] as const;
export type LogoCorner = (typeof LOGO_CORNERS)[number];
export const DEFAULT_LOGO_CORNER: LogoCorner = "top_right";
export const isLogoCorner = (v: unknown): v is LogoCorner => (LOGO_CORNERS as readonly string[]).includes(String(v));

/** Seconds of the video the end card takes, counted back from the end. */
export const END_CARD_SECONDS = 3;
const MIN_VIDEO_SECONDS = 6; // shorter than this there's no scene left to zoom out of
const SHRINK_SECONDS = 2; // the scene pulls back over this long
const SHRINK_TO = 0.82; // and ends at this share of the frame
const SCENE_FADE_FROM = 0.5; // it starts dissolving into the blur this far into the window
const SCENE_FADE_SECONDS = 1.4;
const LOGO_FADE_FROM = 1.2; // the logo comes in as the scene dissolves
const LOGO_FADE_SECONDS = 0.8;
const BLUR_SIGMA = 36;
const FROST = 0.55; // how much white is washed over the blur so a dark logo reads
const END_LOGO_WIDTH = 0.6; // the end card's logo, as a share of the frame's width (its transparent margins trimmed)
const MARK_WIDTH = 0.2; // the corner mark, as a share of the frame's width: small but visible
const MARK_GLOW = 0.04; // its glow's reach, as a share of the mark's width
const MARK_FADE_SECONDS = 0.3; // the corner mark leaves just before the end card takes over

const even = (n: number) => 2 * Math.round(n / 2);
const num = (n: number) => n.toFixed(3);

/** Where the corner mark sits (overlay expressions): clear of Reels and Stories' top bar and bottom caption. */
export function cornerPosition(corner: LogoCorner, width: number, height: number) {
  const tall = height / width > 1.5;
  const side = Math.round(width * (tall ? 0.05 : 0.04));
  const top = Math.round(tall ? height * 0.12 : width * 0.04);
  const bottom = Math.round(tall ? height * 0.22 : width * 0.04);
  return {
    x: corner.endsWith("left") ? `${side}` : `W-w-${side}`,
    y: corner.startsWith("top") ? `${top}` : `H-h-${bottom}`,
  };
}

/**
 * The ffmpeg filter graph for a video `seconds` long and `width` x `height`. Input 1 is the corner mark
 * (a looped PNG, always), input 2 the end card's logo (only with `endCard`). Pure, so the timings are
 * testable. Output pad: [v].
 */
export function overlayFilter(seconds: number, width: number, height: number, opts: { corner: LogoCorner; endCard: boolean }) {
  const t0 = seconds - END_CARD_SECONDS;
  const pos = cornerPosition(opts.corner, width, height);
  // The mark fades out as the end card begins (or stays, when the video's too short for one)
  const mark = opts.endCard
    ? `[1:v]format=rgba,fade=t=out:st=${num(t0 - MARK_FADE_SECONDS)}:d=${MARK_FADE_SECONDS}:alpha=1[mark]`
    : "[1:v]format=rgba[mark]";
  const marked = `[0:v][mark]overlay=x='${pos.x}':y='${pos.y}'[scene]`;
  if (!opts.endCard) return [mark, marked.replace("[scene]", "[v]")].join(";");

  const logoW = even(width * END_LOGO_WIDTH);
  // How far into the pull-back the scene is, 0 to 1, easing out
  const p = `(1-pow(1-clip((t-${num(t0)})/${SHRINK_SECONDS},0,1),2))`;
  return [
    mark,
    marked,
    "[scene]split=2[fg0][bg0]",
    // The same scene, blurred and washed with white, fills the frame behind the shrinking one
    `[bg0]scale=${width}:${height},gblur=sigma=${BLUR_SIGMA}:steps=2,drawbox=x=0:y=0:w=iw:h=ih:color=white@${FROST}:t=fill[bg]`,
    `[fg0]format=yuva420p,fade=t=out:st=${num(t0 + SCENE_FADE_FROM)}:d=${SCENE_FADE_SECONDS}:alpha=1,` +
      `scale=w='2*trunc(${width}*(1-${num(1 - SHRINK_TO)}*${p})/2)':h='2*trunc(${height}*(1-${num(1 - SHRINK_TO)}*${p})/2)':eval=frame[fg]`,
    "[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame[base]",
    `[2:v]scale=${logoW}:-1,format=yuva420p,fade=t=in:st=${num(t0 + LOGO_FADE_FROM)}:d=${LOGO_FADE_SECONDS}:alpha=1[logo]`,
    "[base][logo]overlay=x='(W-w)/2':y='(H-h)/2'[v]",
  ].join(";");
}

/** The overlay for a still image (input 0 the image, input 1 the corner mark). Output pad: [v]. */
export function imageOverlayFilter(width: number, height: number, corner: LogoCorner) {
  const pos = cornerPosition(corner, width, height);
  return `[1:v]format=rgba[mark];[0:v][mark]overlay=x='${pos.x}':y='${pos.y}':format=auto[v]`;
}

/** The part of a logo that isn't transparent, as fractions of its size (the whole image when it has no transparency). */
export function opaqueBounds(rgba: Buffer, width: number, height: number) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = 0.02; // a hair of room so the edge isn't clipped
  const fx0 = Math.max(0, x0 / width - pad), fy0 = Math.max(0, y0 / height - pad);
  const fx1 = Math.min(1, (x1 + 1) / width + pad), fy1 = Math.min(1, (y1 + 1) / height + pad);
  return { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 };
}

const cropFilter = (b: { x: number; y: number; w: number; h: number }) =>
  `crop=iw*${b.w.toFixed(4)}:ih*${b.h.toFixed(4)}:iw*${b.x.toFixed(4)}:ih*${b.y.toFixed(4)}`;

/** The corner mark (trimmed logo, scaled, with a soft white glow) as a filter graph on input 0. Output pad: [mark]. */
export function markFilter(bounds: { x: number; y: number; w: number; h: number }, markW: number) {
  const glow = Math.max(4, Math.round(markW * MARK_GLOW));
  return [
    `[0:v]${cropFilter(bounds)},scale=${markW}:-1:flags=lanczos,format=rgba,pad=iw+${glow * 4}:ih+${glow * 4}:${glow * 2}:${glow * 2}:color=0x00000000,split[a][b]`,
    `[b]lutrgb=r=255:g=255:b=255,gblur=sigma=${glow},colorchannelmixer=aa=2[glow]`,
    `[glow][a]overlay=format=auto[mark]`,
  ].join(";");
}

type Prepared = { bin: string; dir: string; mark: string; endLogo: string };

async function readBounds(bin: string, logoFile: string) {
  const size = 256;
  const { stdout } = await run(bin, ["-loglevel", "error", "-i", logoFile, "-vf", `scale=${size}:-1,format=rgba`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  const raw = stdout as unknown as Buffer;
  return opaqueBounds(raw, size, raw.length / 4 / size);
}

/** Renders the logo's two forms (corner mark, end-card logo) as transparent PNGs, sized for a frame `width` wide. */
async function prepare(bin: string, dir: string, logo: Buffer, width: number): Promise<Prepared> {
  const logoFile = join(dir, "logo");
  const mark = join(dir, "mark.png");
  const endLogo = join(dir, "end-logo.png");
  await writeFile(logoFile, logo);
  const bounds = await readBounds(bin, logoFile);
  const opts = { timeout: 30_000 };
  await run(bin, ["-loglevel", "error", "-y", "-i", logoFile, "-filter_complex", markFilter(bounds, even(width * MARK_WIDTH)), "-map", "[mark]", "-frames:v", "1", mark], opts);
  await run(bin, ["-loglevel", "error", "-y", "-i", logoFile, "-vf", `${cropFilter(bounds)},scale=${even(width * END_LOGO_WIDTH)}:-1:flags=lanczos,format=rgba`, "-frames:v", "1", endLogo], opts);
  return { bin, dir, mark, endLogo };
}

/**
 * The video with the agent's logo on it: a small corner mark throughout and, when the video is long enough,
 * the end card over its last seconds. The sound is copied untouched. Null when ffmpeg isn't available here.
 */
export async function addLogoToVideo(video: Buffer, logo: Buffer, corner: LogoCorner = DEFAULT_LOGO_CORNER): Promise<Buffer | null> {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "logo-"));
  try {
    const vIn = join(dir, "in.mp4");
    const out = join(dir, "out.mp4");
    await writeFile(vIn, video);
    const v = await probe(bin, vIn);
    if (!v.seconds || !v.width || !v.height) throw new Error("Couldn't read the video's length and size");
    const width = even(v.width);
    const height = even(v.height);
    const endCard = v.seconds >= MIN_VIDEO_SECONDS;
    const p = await prepare(bin, dir, logo, width);
    const loop = ["-loop", "1", "-framerate", "30", "-t", num(v.seconds)];
    await run(
      bin,
      [
        "-loglevel", "error", "-y",
        "-i", vIn,
        ...loop, "-i", p.mark,
        ...(endCard ? [...loop, "-i", p.endLogo] : []),
        "-filter_complex", overlayFilter(v.seconds, width, height, { corner, endCard }),
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

/** The image with the corner mark on it (always returned as a PNG). Null when ffmpeg isn't available here. */
export async function addLogoToImage(image: Buffer, logo: Buffer, corner: LogoCorner = DEFAULT_LOGO_CORNER): Promise<Buffer | null> {
  const bin = await ffmpegPath();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "logo-"));
  try {
    const iIn = join(dir, "in-image");
    const out = join(dir, "out.png");
    await writeFile(iIn, image);
    const v = await probe(bin, iIn);
    if (!v.width || !v.height) throw new Error("Couldn't read the image's size");
    const p = await prepare(bin, dir, logo, even(v.width));
    await run(bin, ["-loglevel", "error", "-y", "-i", iIn, "-i", p.mark, "-filter_complex", imageOverlayFilter(v.width, v.height, corner), "-map", "[v]", "-frames:v", "1", out], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
