// Writes a render-worker job from local files, for a free local test of the full edit (no paid services: the word
// times are estimated from the audio's silences and the known script; the job clips are pans across job photos).
//   node --import tsx scripts/migz/edit-local.mts <talk.mp4> "<script>" <job1.jpg,job2.jpg,...> <out-dir> [face x,y,w,h]
// then, with Node 22:  cd render-worker && node render.mjs <out-dir>/job.json <out-dir>/final.mp4
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPlan, type Box } from "../../src/lib/edit/plan.ts";
import { fixPlan } from "../../src/lib/edit/qc.ts";
import { buildComposition } from "../../src/lib/edit/composition.ts";
import { readableBrand } from "../../src/lib/edit/brand.ts";
import type { Word } from "../../src/lib/edit/words.ts";

const FFMPEG = (await import("ffmpeg-static")).default as unknown as string;
const [talkArg, script, photosArg, outArg, faceArg] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const talk = resolve(talkArg);

// Speech stretches from the silences, words spread over them by length
const report = spawnSync(FFMPEG, ["-hide_banner", "-i", talk, "-af", "silencedetect=n=-35dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const total = (() => {
  const d = report.match(/Duration: (\d+):(\d+):([\d.]+)/)!;
  return +d[1] * 3600 + +d[2] * 60 + +d[3];
})();
const starts = [...report.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
const ends = [...report.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
const speech: { from: number; to: number }[] = [];
let cursor = 0;
for (let i = 0; i < starts.length; i++) {
  if (starts[i] - cursor > 0.15) speech.push({ from: cursor, to: starts[i] });
  cursor = ends[i] ?? total;
}
if (total - cursor > 0.15) speech.push({ from: cursor, to: total });
const tokens = script.split(/\s+/);
const totalSpeech = speech.reduce((n, s) => n + s.to - s.from, 0);
const weight = (w: string) => w.length + 2;
const totalWeight = tokens.reduce((n, w) => n + weight(w), 0);
// Cumulative length of the script mapped onto cumulative speech time, so every word lands inside speech
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

// Job clips: a slow push across each photo
const photos = photosArg.split(",").map((p) => resolve(p));
photos.forEach((p, i) =>
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-loop", "1", "-i", p, "-t", "2.6", "-vf", "scale=1300:-2,zoompan=z='1+0.0016*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", join(out, `broll${i}.mp4`)]),
);

const face: Box | null = faceArg ? (([x, y, w, h]) => ({ x, y, w, h }))(faceArg.split(",").map(Number)) : null;
const input = {
  words,
  sourceSeconds: total,
  sourceHeight: 720,
  face,
  broll: photos.length,
  hook: "Kenmore homeowners",
  towns: ["Kenmore", "Bothell"],
  deals: ["$500 off a full replacement"],
  certifications: ["CertainTeed ShingleMaster"],
  license: "WA Lic #SUMMIPR123AB",
  warranties: ["25-year workmanship warranty"],
  names: ["Summit Peak Roofing", "Kenmore", "Bothell", "CertainTeed ShingleMaster"],
  hasLogo: false,
};
const { plan, checks } = fixPlan(buildPlan(input), { face, names: input.names, sourceWords: words });
for (const c of checks) console.log(`${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`);
const brand = readableBrand({ headingFont: "Montserrat", bodyFont: "Inter", background: "#0B1F3A", text: "#FFFFFF", accent: "#E4572E" });
const html = buildComposition(plan, brand, { headingWeights: [800], bodyWeights: [400], hasLogo: false, brollCount: plan.broll.length });

// Fonts and sounds from what's on hand: Montserrat and Inter from Google Fonts, sounds synthesized
const fontCss = async (family: string, w: number) => {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${w}`, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36" } })).text();
  return [...css.matchAll(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{[^}]*url\((https:[^)]+\.woff2)\)/g)][0]?.[1];
};
const fonts = [
  { file: "heading-800.woff2", url: await fontCss("Montserrat", 800) },
  { file: "body-400.woff2", url: await fontCss("Inter", 400) },
].filter((f) => f.url);
const synth: Record<string, string[]> = {
  hit: ["-f", "lavfi", "-i", "sine=f=55:d=0.6", "-af", "afade=t=out:st=0.05:d=0.55,volume=3"],
  click: ["-f", "lavfi", "-i", "anoisesrc=d=0.03:c=white:a=0.9", "-af", "highpass=f=2500,afade=t=out:st=0.005:d=0.025"],
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.6", "-af", "bandpass=f=1500:width_type=h:w=1400,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.3"],
  pop: ["-f", "lavfi", "-i", "sine=f=1100:d=0.06", "-af", "afade=t=out:st=0.01:d=0.05"],
  swoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.45:c=pink:a=0.6", "-af", "bandpass=f=2500:width_type=h:w=2000,afade=t=in:d=0.1,afade=t=out:st=0.1:d=0.35"],
  riser: ["-f", "lavfi", "-i", "sine=f=220:d=0.7", "-af", "vibrato=f=6,afade=t=in:d=0.6,volume=0.6"],
};
const sfx: Record<string, string> = {};
for (const [k, args] of Object.entries(synth)) {
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", ...args, join(out, `sfx-${k}.wav`)]);
  sfx[k] = `file://${join(out, `sfx-${k}.wav`)}`;
}
execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=110:d=40", "-f", "lavfi", "-i", "sine=f=165:d=40", "-filter_complex", "[0][1]amix=inputs=2,volume=0.3,tremolo=f=2:d=0.4", join(out, "music.wav")]);

const job = {
  jobId: "local-test",
  fps: plan.fps,
  seconds: plan.seconds,
  segments: plan.segments,
  html,
  sfx: plan.sfx,
  musicEnd: plan.musicEnd,
  fonts,
  media: { talk: `file://${talk}`, broll: plan.broll.map((b) => `file://${join(out, `broll${b.index}.mp4`)}`), logo: null, music: `file://${join(out, "music.wav")}`, sfx },
  upload: "local",
  callback: "local",
};
writeFileSync(join(out, "job.json"), JSON.stringify(job, null, 2));
writeFileSync(join(out, "plan.json"), JSON.stringify(plan, null, 2));
console.log(`\n${total.toFixed(1)}s raw -> ${plan.seconds.toFixed(1)}s edited, ${plan.segments.length - 1} cuts, ${plan.captions.length} captions, ${plan.cards.length} cards, ${plan.broll.length} cut-aways, ${plan.sfx.length} sounds`);
console.log(plan.cards.map((c) => `  ${c.start.toFixed(2)}s ${c.kind}: ${c.text}`).join("\n"));
