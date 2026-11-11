// The Migz video edit, the parts with no I/O: takes, tight cut, names, numbers, the plan, its checks, the
// HyperFrames composition and the brand.
//   node --import tsx scripts/migz/edit.test.mts
import assert from "node:assert/strict";
import { cleanTakes, editedLength, fixNames, spokenNumber, tightCut, type Word } from "../../src/lib/edit/words.ts";
import { buildPlan, SAFE, scaleAt, type EditInput } from "../../src/lib/edit/plan.ts";
import { checkPlan, checkRender, fixPlan } from "../../src/lib/edit/qc.ts";
import { buildComposition } from "../../src/lib/edit/composition.ts";
import { brandCandidates, closestGoogleFont, contrast, pickBrand, readableBrand } from "../../src/lib/edit/brand.ts";

// A transcript the way the speech-to-text returns it: a filler, a restart, pauses, a misheard brand, a spoken price
function transcript(text: string, opts: { pauseAfter?: RegExp } = {}): Word[] {
  const out: Word[] = [];
  let t = 0.25;
  for (const w of text.split(/\s+/)) {
    const len = 0.12 + w.replace(/[^a-z]/gi, "").length * 0.035;
    out.push({ word: w, start: Number(t.toFixed(3)), end: Number((t + len).toFixed(3)) });
    t += len + (/[.!?]$/.test(w) ? 0.45 : /,$/.test(w) ? 0.22 : 0.04);
    if (opts.pauseAfter?.test(w)) t += 0.6;
  }
  return out;
}
const SCRIPT =
  "Kenmore and Bothell homeowners, is your roof ready for another winter? Most roof leaks start um years before you see them. I own Summit I own Summit Peak Roofing, and I'm a Certainteed Shingle Master roofer. Let me check it before the rain does. If you need a full replacement, it's five hundred dollars off. Every job comes with a 25-year workmanship warranty. Tap Learn More for your free inspection.";
const words = transcript(SCRIPT);
const sourceSeconds = words.at(-1)!.end + 0.6;

// ---------- takes and the tight cut ----------
const takes = cleanTakes(words);
assert.ok(!takes.some((w) => w.word === "um"), "fillers go");
assert.equal(takes.filter((w) => w.word === "own").length, 1, "a restart keeps only the last complete take");
const segs = tightCut(takes, 30, sourceSeconds);
const handle = 2 / 30;
for (const w of takes) assert.ok(segs.some((s) => w.start >= s.from - 1e-6 && w.end <= s.to + 1e-6), `${w.word} is whole inside a kept stretch`);
for (let i = 1; i < segs.length; i++) assert.ok(segs[i].from >= segs[i - 1].to - 1e-6, "kept stretches don't overlap");
assert.ok(editedLength(segs) < sourceSeconds - 2, `pauses cut: ${sourceSeconds.toFixed(1)}s -> ${editedLength(segs).toFixed(1)}s`);
assert.ok(segs[0].from <= takes[0].start - handle + 1e-6 || segs[0].from === 0, "2 frames of handle");

// ---------- names and numbers ----------
const fixed = fixNames(takes, ["CertainTeed ShingleMaster", "Summit Peak Roofing", "Kenmore", "Bothell"]);
const joined = fixed.map((w) => w.word).join(" ");
assert.match(joined, /a CertainTeed ShingleMaster roofer/, joined);
assert.match(joined, /Summit Peak Roofing,/, "punctuation after a fixed name stays");
const say = (s: string) => transcript(s);
assert.deepEqual(spokenNumber(say("five hundred dollars off"), 0), { value: 500, unit: "dollars", plus: false, first: 0, last: 2 });
assert.equal(spokenNumber(say("$500 off"), 0)!.value, 500);
assert.equal(spokenNumber(say("$500 off"), 0)!.unit, "dollars");
assert.deepEqual(spokenNumber(say("25-year warranty"), 0), { value: 25, unit: "years", plus: false, first: 0, last: 0 });
assert.equal(spokenNumber(say("fifteen plus years"), 0)!.plus, true);
assert.equal(spokenNumber(say("twenty-five-year warranty"), 0)!.value, 25);
assert.equal(spokenNumber(say("roof leaks"), 0), null);

// ---------- the plan ----------
const face = { x: 360, y: 430, w: 360, h: 430 }; // a typical HeyGen framing, face in the upper middle
const input: EditInput = {
  words,
  sourceSeconds,
  sourceHeight: 1080,
  face,
  broll: 3,
  hook: "Kenmore homeowners",
  towns: ["Kenmore", "Bothell"],
  deals: ["$500 off a full replacement"],
  certifications: ["CertainTeed ShingleMaster"],
  license: "WA Lic #SUMMIPR123AB",
  warranties: ["25-year workmanship warranty"],
  names: ["Summit Peak Roofing", "Kenmore", "Bothell", "CertainTeed ShingleMaster"],
  hasLogo: true,
};
const plan = buildPlan(input);
assert.equal(plan.framings[0].start, 0);
assert.equal(plan.framings[0].framing, "close", "frame 0 is a punch-in, not a static wide");
assert.equal(plan.closeScale, 1.15, "1080p source: close framing capped at 115%");
assert.equal(buildPlan({ ...input, sourceHeight: 720 }).closeScale, 1.1, "720p source: 110%");
assert.ok(plan.hook && plan.hook.end > 1 && plan.hook.end <= 3.5, "the hook is up from frame 0 until the first sentence ends");
assert.equal(plan.hook!.accent, "Kenmore");
assert.ok(plan.captions.length > 5 && plan.captions.every((c) => c.words.length >= 1 && c.words.length <= 4), "2 to 4 word captions");
assert.ok(plan.captions[0].start >= plan.hook!.end - 0.01, "captions switch on as the hook goes");

const byKind = (k: string) => plan.cards.filter((c) => c.kind === k);
const offer = byKind("number").find((c) => c.text === "$500 OFF");
assert.ok(offer, `the offer shows when it's said: ${JSON.stringify(plan.cards.map((c) => [c.kind, c.text]))}`);
assert.equal(offer!.sub, "a full replacement");
const five = plan.words.find((w) => w.word === "five")!;
assert.ok(Math.abs(offer!.start - five.start) <= 2 / 30, "the offer card lands on 'five'");
const cert = byKind("cert")[0];
assert.ok(cert && cert.text === "CertainTeed ShingleMaster", "the certification card on its name");
assert.ok(Math.abs(cert.start - plan.words.find((w) => w.word === "CertainTeed")!.start) <= 2 / 30);
assert.ok(byKind("number").some((c) => c.text === "25 YEARS") || byKind("warranty").length, "the warranty or its number shows");
const cta = byKind("cta")[0];
assert.ok(cta && Math.abs(cta.start - plan.words.find((w) => w.word === "Tap")!.start) <= 2 / 30, "the last card on 'Tap'");
assert.ok(cta.end === plan.loopFrom && plan.loopFrom < plan.seconds, "then the loop frames");
assert.ok(plan.broll.length >= 1 && plan.broll.length <= 3, `${plan.broll.length} cut-aways`);
for (const b of plan.broll) assert.ok(b.start >= plan.captionsFrom && b.end <= cta.start, "cut-aways stay out of the hook and the last card");
for (const c of plan.cards) for (const d of plan.cards) if (c !== d) assert.ok(c.end <= d.start || d.end <= c.start, "one card at a time");
// Sounds: few, on beats, never on top of each other
assert.equal(plan.sfx[0].kind, "hit");
for (let i = 1; i < plan.sfx.length; i++) assert.ok(plan.sfx[i].at - plan.sfx[i - 1].at >= 0.39, "sounds at least 0.4s apart");
assert.ok(plan.sfx.length <= plan.seconds / 1.2, `${plan.sfx.length} sounds in ${plan.seconds.toFixed(1)}s isn't a meme edit`);
assert.ok(plan.musicEnd <= plan.seconds && plan.musicEnd >= plan.words.at(-1)!.end, "music ends on the last word");
// Zoom never exceeds the cap (+ a push) and comes back to frame 0's framing for the loop
for (let t = 0; t < plan.seconds; t += 0.1) assert.ok(scaleAt(plan, t) <= plan.closeScale * 1.08 + 1e-6);

// ---------- checks ----------
const checks = checkPlan(plan, { face, names: input.names, sourceWords: takes });
for (const c of checks) assert.ok(c.pass, `${c.name}: ${c.detail}`);
console.log(checks.map((c) => `  ${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n"));
// A face low in the frame pushes the text out of its way, or the checks catch it
const lowFace = { x: 300, y: 900, w: 480, h: 560 };
const low = fixPlan(buildPlan({ ...input, face: lowFace }), { face: lowFace, names: input.names, sourceWords: takes });
const lowFaces = low.checks.find((c) => c.name === "Faces")!;
const lowSafe = low.checks.find((c) => c.name === "Safe zone")!;
assert.ok(lowSafe.pass, lowSafe.detail);
assert.ok(lowFaces.pass || /Over the face/.test(lowFaces.detail), "a face the text can't avoid is reported, never hidden");
// A misspelling left on screen fails
const bad = { ...plan, captions: [{ start: 3, end: 4, words: [{ word: "Certainted", start: 3, end: 3.5 }] }] };
assert.equal(checkPlan(bad, { face, names: input.names, sourceWords: takes }).find((c) => c.name === "Captions")!.pass, false);
// Everything sits in the safe zone
for (const c of plan.cards) assert.ok(c.box.y >= SAFE.top && c.box.y + c.box.h <= SAFE.bottom && c.box.x + c.box.w <= SAFE.right, `${c.kind} in the safe zone`);
// Render checks
assert.ok(checkRender({ lufs: -14.2, truePeak: -1.1, blackFrames: 0, frozenSeconds: 0.3, loopMatch: 0.995, seconds: 24, width: 1080, height: 1920 }).every((c) => c.pass));
assert.ok(!checkRender({ lufs: -18, truePeak: -0.2, blackFrames: 2, frozenSeconds: 0, loopMatch: 0.8, seconds: 24, width: 1080, height: 1920 }).some((c) => c.pass && c.name !== "Format"));

// ---------- composition ----------
const brand = readableBrand({ headingFont: "Montserrat", bodyFont: "Inter", background: "#0B1F3A", text: "#FFFFFF", accent: "#E4572E" });
const html = buildComposition(plan, brand, { headingWeights: [700, 800], bodyWeights: [400], hasLogo: true, brollCount: plan.broll.length });
assert.match(html, /data-composition-id="ad"/);
assert.match(html, /window\.__timelines\.ad = tl;/);
assert.match(html, new RegExp(`data-duration="${Number(plan.seconds.toFixed(3))}"`));
for (const v of html.match(/<video[^>]*>/g) ?? []) assert.match(v, /\bmuted\b/, "every video is silent (the sound is mixed separately)");
assert.equal((html.match(/<video/g) ?? []).length, 1 + plan.broll.length);
assert.match(html, /src="\.\/logo\.png"/);
assert.ok(!/D97757/i.test(html), "no Claude orange");
assert.match(html, /#E4572E/, "their accent");
assert.match(html, /ease:"expo\.out"/);
assert.ok(!/ease:"(bounce|elastic|back)/.test(html), "no bounce");
assert.match(html, /\$500 OFF/);
assert.match(html, /font-family:"heading"/);
assert.match(html, /src:url\(\.\/fonts\/heading-800\.woff2\)/);

// ---------- brand ----------
const site = `<html><head><meta name="theme-color" content="#c8102e"><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&family=Open+Sans&display=swap" rel="stylesheet"><style>
:root{--brand:#C8102E;--ink:#111827}
body{font-family:"Open Sans",Arial,sans-serif;background:#ffffff;color:var(--ink)}
h1,h2{font-family:'Oswald',Impact,sans-serif}
.btn{background:var(--brand);color:#fff}.btn:hover{background:#a00d25}
</style></head><body><h1>Summit Peak Roofing</h1></body></html>`;
const cand = brandCandidates(site, "");
assert.equal(cand.headingFonts[0], "Oswald");
assert.equal(cand.bodyFonts[0], "Open Sans");
const picked = pickBrand(cand);
assert.equal(picked.accent, "#C8102E", "the theme colour is the accent");
assert.equal(picked.background, "#FFFFFF");
assert.equal(picked.text, "#111827", "CSS variables are resolved");
const onVideo = readableBrand({ ...picked, headingFont: picked.headingFont!, bodyFont: picked.bodyFont! });
assert.equal(onVideo.background, "#111827", "a white site background becomes their dark text colour for cards over footage");
assert.ok(contrast(onVideo.text, onVideo.background) >= 4.5);
assert.equal(onVideo.accent, "#C8102E");
assert.equal(readableBrand({ accent: "#777777" }).accent, "#F59E0B", "a grey accent is replaced");
assert.equal(closestGoogleFont("Gotham Bold"), "Montserrat");
assert.equal(closestGoogleFont("Helvetica Neue"), "Inter");
assert.equal(closestGoogleFont("Some Serif Font"), "Merriweather");

console.log("edit checks passed");
for (const c of plan.captions) assert.ok(!c.words.slice(0, -1).some((w) => /[.!?]$/.test(w.word)), `a caption never runs across a sentence end: ${c.words.map((w) => w.word).join(" ")}`);
console.log("caption sentence check passed");
