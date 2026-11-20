// A free local test of the full edit: a founder's selfie video, their b-roll (clips or photos) and our own sound
// library in, a render-worker job out. No paid services: word times are estimated from the audio's silences and the
// script they read (or taken from a transcript JSON when you have one).
//
//   node --import tsx scripts/migz/edit-local.mts <edit.json> <out-dir>
// then, with Node 22:
//   cd render-worker && node render.mjs <out-dir>/job.json <out-dir>/final.mp4
//
// edit.json (paths relative to the file; everything but talk and script is optional):
// {
//   "talk": "founder-selfie.mp4",             the founder reading our script to camera
//   "script": "Thinking about a hair transplant in Austin? ...",   what they read (ignored when transcript is given)
//   "transcript": "words.json",               [{ "word", "start", "end" }] in seconds, if you have a real one
//   "broll": ["clinic-tour.mp4", "consult-room.jpg"],   clips cut in as they are (1s in, 4s kept), photos get a slow push
//   "sfx": "sfx/",                            a folder of sounds sorted by filename (whoosh, swoosh, click, pop, ding, riser, hit)
//   "music": "bed.mp3",                       a track of your own, or by mood:
//   "musicMood": "soft", "musicDir": "music/",  <musicDir>/<mood>.mp3 (scripts/migz/make-music.mts --out writes these)
//   "reviews": { "rating": 4.9, "count": 212 },  their Google rating, for the reviews card
//   "face": [x, y, w, h],                     the face in the 1080x1920 frame, when you know it
//   "brand": { "headingFont": "Montserrat", "bodyFont": "Inter", "background": "#0B1F3A", "text": "#FFFFFF", "accent": "#2D7FF9" },
//   "hook": "Austin hair transplant consultations",
//   "audience": "hair transplants",            used when the hook is too long: "<first town> <audience>" (default "homeowners")
//   "towns": ["Austin"], "deals": [], "certifications": ["Board-certified surgeon"], "license": null, "warranties": [],
//   "offer": "free consultation",
//   "person": { "name": "Dr. Sam Lee", "role": "Lead surgeon" }, "company": "Lee Hair Clinic", "area": "Austin, TX",
//   "names": ["Lee Hair Clinic", "Austin"]   every name and brand, spelled as it must appear
// }
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { buildPlan, type Box, type SfxKind } from "../../src/lib/edit/plan.ts";
import { fixPlan } from "../../src/lib/edit/qc.ts";
import { buildComposition } from "../../src/lib/edit/composition.ts";
import { readableBrand } from "../../src/lib/edit/brand.ts";
import { SFX_KINDS, SFX_STAND_INS, sortSfx } from "../../src/lib/edit/sfx-library.ts";
import type { Word } from "../../src/lib/edit/words.ts";

type Config = {
  talk: string;
  script?: string;
  transcript?: string;
  broll?: string[];
  sfx?: string;
  music?: string;
  musicMood?: string;
  musicDir?: string;
  reviews?: { rating: number | null; count: number | null } | null;
  face?: [number, number, number, number];
  brand?: { headingFont?: string; bodyFont?: string; background?: string; text?: string; accent?: string };
  hook?: string | null;
  audience?: string | null;
  towns?: string[];
  deals?: string[];
  certifications?: string[];
  license?: string | null;
  warranties?: string[];
  offer?: string | null;
  person?: { name: string; role: string | null } | null;
  company?: string | null;
  area?: string | null;
  names?: string[];
};

const FFMPEG = process.env.FFMPEG_PATH || ((await import("ffmpeg-static")).default as unknown as string);
const [configArg, outArg] = process.argv.slice(2);
if (!configArg || !outArg) {
  console.error("Usage: node --import tsx scripts/migz/edit-local.mts <edit.json> <out-dir>");
  process.exit(1);
}
const configPath = resolve(configArg);
const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Config;
const from = (p: string) => resolve(dirname(configPath), p);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const talk = from(cfg.talk);
if (!existsSync(talk)) throw new Error(`No talking video at ${talk}`);

// The talking video's length and height
const probe = spawnSync(FFMPEG, ["-hide_banner", "-i", talk], { encoding: "utf8" }).stderr;
const dur = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
if (!dur) throw new Error("Couldn't read the talking video");
const total = +dur[1] * 3600 + +dur[2] * 60 + +dur[3];
const size = probe.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
const shortSide = size ? Math.min(+size[1], +size[2]) : 720;
if (!/Audio:/.test(probe)) throw new Error("The talking video has no sound");

// ---------- Word times ----------
function estimateWords(script: string): Word[] {
  // Speech stretches from the silences, the script's words spread over them by length
  const report = spawnSync(FFMPEG, ["-hide_banner", "-i", talk, "-af", "silencedetect=n=-35dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...report.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...report.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const speech: { from: number; to: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] - cursor > 0.15) speech.push({ from: cursor, to: starts[i] });
    cursor = ends[i] ?? total;
  }
  if (total - cursor > 0.15) speech.push({ from: cursor, to: total });
  if (!speech.length) throw new Error("No speech found in the talking video");
  const tokens = script.split(/\s+/).filter(Boolean);
  const totalSpeech = speech.reduce((n, s) => n + s.to - s.from, 0);
  const weight = (w: string) => w.length + 2;
  const totalWeight = tokens.reduce((n, w) => n + weight(w), 0);
  const at = (frac: number) => {
    let left = frac * totalSpeech;
    for (const s of speech) {
      if (left <= s.to - s.from) return s.from + left;
      left -= s.to - s.from;
    }
    return speech.at(-1)!.to;
  };
  const words: Word[] = [];
  let acc = 0;
  for (const w of tokens) {
    const a = at(acc / totalWeight);
    acc += weight(w);
    const b = at(acc / totalWeight);
    // A word never spans a silence: it ends where its stretch of speech ends
    const chunkEnd = speech.find((s) => a >= s.from - 1e-6 && a <= s.to + 1e-6)?.to ?? b;
    words.push({ word: w, start: +a.toFixed(3), end: +Math.max(a + 0.06, Math.min(b - 0.02, chunkEnd)).toFixed(3) });
  }
  return words;
}
const words: Word[] = cfg.transcript
  ? (JSON.parse(readFileSync(from(cfg.transcript), "utf8")) as Word[])
  : cfg.script
    ? estimateWords(cfg.script)
    : (() => {
        throw new Error("edit.json needs the script they read (or a transcript)");
      })();

// ---------- B-roll: real clips as they are, photos with a slow push ----------
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const FRAME = "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=30,setsar=1,format=yuv420p";
const broll = (cfg.broll ?? []).map(from);
broll.forEach((p, i) => {
  if (!existsSync(p)) throw new Error(`No b-roll file at ${p}`);
  const dest = join(out, `broll${i}.mp4`);
  if (VIDEO.test(p)) {
    const len = +(spawnSync(FFMPEG, ["-hide_banner", "-i", p], { encoding: "utf8" }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)?.slice(1).reduce((s, v, k) => s + +v * [3600, 60, 1][k], 0) ?? 0);
    // Skip the first second (camera shake, someone pressing record) when there's room, keep 4 seconds
    const skip = len > 5 ? 1 : 0;
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-ss", String(skip), "-t", "4", "-i", p, "-vf", FRAME, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", dest]);
  } else {
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-loop", "1", "-i", p, "-t", "2.6", "-vf", "scale=1300:-2,zoompan=z='1+0.0016*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", dest]);
  }
});

// ---------- The plan ----------
const face: Box | null = cfg.face ? (([x, y, w, h]) => ({ x, y, w, h }))(cfg.face) : null;
const names = cfg.names ?? [cfg.company, cfg.person?.name, ...(cfg.towns ?? []), ...(cfg.certifications ?? [])].filter((n): n is string => !!n);
const input = {
  words,
  sourceSeconds: total,
  sourceHeight: shortSide >= 1080 ? 1080 : 720,
  face,
  broll: broll.length,
  hook: cfg.hook ?? null,
  audience: cfg.audience ?? null,
  towns: cfg.towns ?? [],
  deals: cfg.deals ?? [],
  offer: cfg.offer ?? null,
  certifications: cfg.certifications ?? [],
  license: cfg.license ?? null,
  warranties: cfg.warranties ?? [],
  names,
  hasLogo: false,
  person: cfg.person ?? null,
  company: cfg.company ?? null,
  area: cfg.area ?? null,
  reviews: cfg.reviews ?? null,
};
const { plan, checks } = fixPlan(buildPlan(input), { face, names, sourceWords: words });
for (const c of checks) console.log(`${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`);
const b = cfg.brand ?? {};
const brand = readableBrand({ headingFont: b.headingFont ?? "Montserrat", bodyFont: b.bodyFont ?? "Inter", background: b.background ?? "#0B1F3A", text: b.text ?? "#FFFFFF", accent: b.accent ?? "#E4572E" });

// ---------- Fonts (Google Fonts; the render falls back to system fonts when offline) ----------
const fontCss = async (family: string, w: number) => {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${w}`;
  const ua = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36";
  try {
    // curl first: it goes through a proxy when one is set, which Node's fetch (before Node 24) doesn't
    const css = (() => {
      try {
        return execFileSync("curl", ["-sfL", "--max-time", "15", "-A", ua, url], { encoding: "utf8" });
      } catch {
        return null;
      }
    })() ?? (await (await fetch(url, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(15000) })).text());
    return [...css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{[^}]*url\((https:[^)]+\.woff2)\)/g)][0]?.[1];
  } catch {
    return undefined;
  }
};
const fonts = [
  { file: "heading-800.woff2", url: await fontCss(brand.headingFont, 800) },
  { file: "body-400.woff2", url: await fontCss(brand.bodyFont, 400) },
].filter((f): f is { file: string; url: string } => !!f.url);
if (fonts.length < 2) console.log("! Couldn't load the brand fonts from Google Fonts; the render will use fallbacks");
const html = buildComposition(plan, brand, { headingWeights: fonts.some((f) => f.file.startsWith("heading")) ? [800] : [], bodyWeights: fonts.some((f) => f.file.startsWith("body")) ? [400] : [], hasLogo: false, brollCount: plan.broll.length });

// ---------- Sounds: our library first, a synthesized stand-in for any kind it doesn't have ----------
const sfx: Partial<Record<SfxKind, string | string[]>> = {};
if (cfg.sfx) {
  const dir = from(cfg.sfx);
  // The music folder (musicDir) can live inside the sound folder: its tracks aren't sound effects
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f.toLowerCase() === "music" ? [] : walk(join(d, f))) : [join(d, f)]));
  const { byKind, unmatched } = sortSfx(walk(dir));
  for (const k of SFX_KINDS) if (byKind[k]?.length) sfx[k] = byKind[k]!.map((p) => `file://${p}`);
  // A cut-away's whip sounds like a whoosh, so a pack without swooshes lends its whooshes
  for (const [k, alt] of SFX_STAND_INS) if (!sfx[k] && sfx[alt]) sfx[k] = sfx[alt];
  console.log(`\nSound library ${relative(process.cwd(), dir) || dir}:`);
  for (const k of SFX_KINDS) console.log(`  ${k.padEnd(7)} ${byKind[k]?.length ? byKind[k]!.map((p) => relative(dir, p)).join(", ") : "(none: synthesized stand-in)"}`);
  if (unmatched.length) console.log(`  not used (name doesn't say what it is): ${unmatched.map((p) => relative(dir, p)).join(", ")}`);
}
const synth: Record<SfxKind, string[]> = {
  hit: ["-f", "lavfi", "-i", "sine=f=55:d=0.6", "-af", "afade=t=out:st=0.05:d=0.55,volume=3"],
  click: ["-f", "lavfi", "-i", "anoisesrc=d=0.03:c=white:a=0.9", "-af", "highpass=f=2500,afade=t=out:st=0.005:d=0.025"],
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.6", "-af", "bandpass=f=1500:width_type=h:w=1400,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.3"],
  pop: ["-f", "lavfi", "-i", "sine=f=1100:d=0.06", "-af", "afade=t=out:st=0.01:d=0.05"],
  swoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.45:c=pink:a=0.6", "-af", "bandpass=f=2500:width_type=h:w=2000,afade=t=in:d=0.1,afade=t=out:st=0.1:d=0.35"],
  riser: ["-f", "lavfi", "-i", "sine=f=220:d=0.7", "-af", "vibrato=f=6,afade=t=in:d=0.6,volume=0.6"],
  ding: ["-f", "lavfi", "-i", "sine=f=1760:d=0.5", "-af", "afade=t=out:st=0.02:d=0.48"],
};
for (const k of SFX_KINDS) {
  if (sfx[k]) continue;
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", ...synth[k], join(out, `sfx-${k}.wav`)]);
  sfx[k] = `file://${join(out, `sfx-${k}.wav`)}`;
}

// ---------- Music: a track they gave, or the mood's track from the music folder (none given: no music) ----------
const moodFile = cfg.musicMood && cfg.musicMood !== "none" && cfg.musicDir ? join(from(cfg.musicDir), `${cfg.musicMood}.mp3`) : null;
if (moodFile && !existsSync(moodFile)) console.warn(`No ${cfg.musicMood}.mp3 in ${cfg.musicDir}: no music`);
const music = cfg.music ? `file://${from(cfg.music)}` : moodFile && existsSync(moodFile) ? `file://${moodFile}` : null;

const job = {
  jobId: "local-test",
  fps: plan.fps,
  seconds: plan.seconds,
  segments: plan.segments,
  html,
  sfx: plan.sfx,
  musicEnd: plan.musicEnd,
  matte: plan.matte,
  fonts,
  media: { talk: `file://${talk}`, broll: plan.broll.map((x) => `file://${join(out, `broll${x.clip ?? x.index}.mp4`)}`), logo: null, music, sfx },
  upload: "local",
  callback: "local",
};
writeFileSync(join(out, "job.json"), JSON.stringify(job, null, 2));
writeFileSync(join(out, "plan.json"), JSON.stringify(plan, null, 2));
console.log(`\n${total.toFixed(1)}s raw -> ${plan.seconds.toFixed(1)}s edited, ${plan.segments.length - 1} cuts, ${plan.captions.length} captions, ${plan.cards.length} cards, ${plan.broll.length} cut-aways, ${plan.sfx.length} sounds`);
console.log(plan.cards.map((c) => `  ${c.start.toFixed(2)}s ${c.kind}: ${c.text}`).join("\n"));
console.log(plan.sfx.map((s) => `  ${s.at.toFixed(2)}s ${s.kind}`).join("\n"));
console.log(`\nNext: cd render-worker && node render.mjs ${join(out, "job.json")} ${join(out, "final.mp4")}`);
