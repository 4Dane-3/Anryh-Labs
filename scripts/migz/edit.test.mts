// The Migz video edit, the parts with no I/O: takes, tight cut, names, numbers, the plan, its checks, the
// HyperFrames composition and the brand.
//   node --import tsx scripts/migz/edit.test.mts
import assert from "node:assert/strict";
import { cleanTakes, editedLength, fixNames, spokenNumber, tightCut, type Word } from "../../src/lib/edit/words.ts";
import { buildPlan, SAFE, scaleAt, type EditInput } from "../../src/lib/edit/plan.ts";
import { checkPlan, checkRender, fixPlan } from "../../src/lib/edit/qc.ts";
import { buildComposition, captionWords } from "../../src/lib/edit/composition.ts";
import { emojiFor } from "../../src/lib/edit/emoji.ts";
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
// "five-star" isn't a number, and never ends before the word it started on (that hung the planner)
assert.equal(spokenNumber(say("50 five-star reviews"), 1), null);
assert.equal(spokenNumber(say("fifty five-star reviews"), 0)!.last, 0);
assert.equal(spokenNumber(say("twenty-five hundred dollars"), 0)!.value, 2500);

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
// A close selfie (the face fills the frame): the video still fills the frame (no shrink, no borders), the zoom is
// gentler, captions may cover the chin, the long callout becomes its first town, and every check passes
const selfie = { x: 65, y: 134, w: 907, h: 1382 };
const sp = fixPlan(buildPlan({ ...input, face: selfie, hook: "Kenmore, Bothell, Woodinville homeowners" }), { face: selfie, names: input.names, sourceWords: takes });
for (const c of sp.checks) assert.ok(c.pass, `selfie ${c.name}: ${c.detail}`);
assert.ok(sp.plan.selfie && sp.plan.fit === null && sp.plan.closeScale < 1.1, "a selfie: full frame, gentler zoom");
assert.ok(sp.plan.chin >= 0.15 && sp.plan.chin <= 0.3, `captions cover at most the chin: ${sp.plan.chin}`);
assert.equal(sp.plan.hook?.text, "Kenmore homeowners");
assert.equal(plan.fit, null, "a normal framing isn't shrunk");
const selfieHtml = buildComposition(sp.plan, readableBrand({ headingFont: "Inter", bodyFont: "Inter", background: "#0B1F3A", text: "#FFFFFF", accent: "#F59E0B" }), { headingWeights: [800], bodyWeights: [400], hasLogo: false, brollCount: sp.plan.broll.length });
assert.ok(!selfieHtml.includes('id="fit"') && !selfieHtml.includes('id="bgv"') && !selfieHtml.includes("vignette"), "no shrunk frame, blurred copy or darkened edges");
// The special is on the last card even when it isn't said
assert.ok(sp.plan.cards.find((c) => c.kind === "cta")!.sub!.length > 0);
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
assert.ok(!/ease:"elastic/.test(html), "no elastic");
// Bounce only where a card drops in
for (const line of html.split("\n").filter((l) => /ease:"bounce/.test(l))) assert.match(line, /^tl\.fromTo\("#card\d+",/, "only dropped cards bounce");
// Only caption words pop with an overshoot; the camera never bounces
for (const line of html.split("\n").filter((l) => /ease:"back/.test(l))) assert.match(line, /^tl\.fromTo\("#cap\d+w\d+e?"/, "only caption words (and their emojis) overshoot");
assert.ok(!/id="bord"|id="border"|class="focus"/.test(html), "no frame, border or brackets around the video");
assert.ok(!/3DFF72/i.test(html), "no neon green");
assert.match(html, /filter id="mbH"/, "whip-pan motion blur");
assert.deepEqual(captionWords(["get", "20%", "off"]).map((w) => w.role), ["fill", "money", "base"]);
assert.deepEqual(captionWords(["designed", "by", "a", "surgeon"]).map((w) => w.role), ["key", "fill", "fill", "base"]);
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
assert.equal(readableBrand({ accent: "#777777" }).accent, "#2D7FF9", "a grey accent is replaced by the default blue");
assert.equal(closestGoogleFont("Gotham Bold"), "Montserrat");
assert.equal(closestGoogleFont("Helvetica Neue"), "Inter");
assert.equal(closestGoogleFont("Some Serif Font"), "Merriweather");

console.log("edit checks passed");
for (const c of plan.captions) assert.ok(!c.words.slice(0, -1).some((w) => /[.!?]$/.test(w.word)), `a caption never runs across a sentence end: ${c.words.map((w) => w.word).join(" ")}`);
console.log("caption sentence check passed");

// The AI presenter's transcript takes the script's spelling (names the transcriber mishears)
{
  const { spellLikeScript } = await import("../../src/lib/edit/words.ts");
  const heard = ["most", "roof", "leaks", "start", "years", "before", "you", "see", "them.", "I'm", "Ezion,", "owner", "of", "Martinez", "Roofing,", "a", "GAF", "master", "elite", "roofer."].map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const fixed = spellLikeScript(heard, "Most roof leaks start years before you see them. I'm Izeahn, owner of Martinez Roofing, a GAF Master Elite roofer.");
  assert.equal(fixed[10].word, "Izeahn,");
  assert.equal(fixed[17].word, "Master");
  assert.equal(fixed[10].start, heard[10].start, "timing kept");
  const extra = spellLikeScript([{ word: "uh", start: 0, end: 0.1 }, ...heard.slice(0, 3)], "Most roof leaks");
  assert.deepEqual(extra.map((w) => w.word), ["Most", "roof", "leaks"], "an extra heard word is folded into the next");
  assert.equal(extra[0].start, 0, "and its time goes with it");
  const split = spellLikeScript(["I'm", "Izzy", "Izeahn,", "owner"].map((word, i) => ({ word, start: i, end: i + 0.9 })), "I'm Izeahn, owner");
  assert.deepEqual(split.map((w) => w.word), ["I'm", "Izeahn,", "owner"], "a name heard as two words shows once");
  assert.equal(spellLikeScript([{ word: "1,000", start: 0, end: 1 }], "one thousand")[0].word, "1,000", "numbers stay as heard");
  console.log("script spelling check passed");
}
for (const c of plan.captions) {
  const last = c.words.at(-1)!.word;
  assert.ok(!/^(a|an|the|to|of|for|your|our)$/i.test(last.replace(/[^a-z]/gi, "")) || /[.!?,]$/.test(last), `a caption never ends on a little word: ${c.words.map((w) => w.word).join(" ")}`);
}
{
  const { splitCaption } = await import("../../src/lib/edit/composition.ts");
  assert.deepEqual(splitCaption(["What", "you", "are", "paying"]), { lead: ["What", "you", "are"], punch: ["paying"] });
  assert.deepEqual(splitCaption(["Let", "us", "take"]), { lead: ["Let", "us"], punch: ["take"] });
  assert.deepEqual(splitCaption(["most", "roof", "leaks"]), { lead: ["most"], punch: ["roof", "leaks"] });
  assert.deepEqual(splitCaption(["leaks", "start"]), { lead: ["leaks"], punch: ["start"] });
  console.log("caption weight check passed");
}

// ---------- cut-aways match the words: "check" cuts to the inspection clip, "leaks" to damage ----------
{
  const kinded = buildPlan({ ...input, broll: 3, brollKinds: ["finished", "damage", "inspection"] });
  const at = (w: string) => kinded.words.find((x) => x.word.toLowerCase().replace(/[^a-z]/g, "") === w)?.start;
  for (const b of kinded.broll) {
    const word = kinded.words.find((x) => Math.abs(x.start - b.start) < 0.01)?.word.toLowerCase().replace(/[^a-z]/g, "");
    if (word === "leaks") assert.equal(b.clip, 1, "leaks → the damage clip");
    if (word === "check") assert.equal(b.clip, 2, "check → the inspection clip");
  }
  assert.equal(new Set(kinded.broll.map((b) => b.clip)).size, kinded.broll.length, "each clip used once");
  assert.ok(at("leaks") !== undefined);
  console.log("cut-away matching passed:", kinded.broll.map((b) => `${kinded.words.find((x) => Math.abs(x.start - b.start) < 0.01)?.word}→${b.clip}`).join(", "));
}

// ---------- our sound library: files sorted by name, variants take turns, a ding on the numbers ----------
{
  const { sfxKindOf, sortSfx, sfxVariant } = await import("../../src/lib/edit/sfx-library.ts");
  assert.equal(sfxKindOf("pack/Whoosh Soft 03.wav"), "whoosh");
  assert.equal(sfxKindOf("Transition Swoosh 1.mp3"), "swoosh");
  assert.equal(sfxKindOf("UI Pop 2.wav"), "pop");
  assert.equal(sfxKindOf("claude_sfx/swings/swing1.mp3"), "pop");
  assert.equal(sfxKindOf("claude_sfx/whoosh_transitions/Whooshes2.mp3"), "whoosh");
  assert.equal(sfxKindOf("claude_sfx/notifs/notif1.mp3"), "ding");
  assert.equal(sfxKindOf("bell-ding.wav"), "ding");
  assert.equal(sfxKindOf("notification chime.m4a"), "ding");
  assert.equal(sfxKindOf("Mouse Click.wav"), "click");
  assert.equal(sfxKindOf("Cinematic Impact Boom.wav"), "hit");
  assert.equal(sfxKindOf("Riser into impact.wav"), "riser", "a riser that ends on a hit is a riser");
  assert.equal(sfxKindOf("Swooshes/07.wav"), "swoosh", "the folder names it when the file doesn't");
  assert.equal(sfxKindOf("readme.txt"), null);
  assert.equal(sfxKindOf("mystery-sound.wav"), null);
  const sorted = sortSfx(["w/Whoosh 10.wav", "w/Whoosh 2.wav", "Ding.wav", "odd.wav", "notes.txt"]);
  assert.deepEqual(sorted.byKind.whoosh, ["w/Whoosh 2.wav", "w/Whoosh 10.wav"], "numbered files in number order");
  assert.deepEqual(sorted.unmatched, ["odd.wav"], "unknown sounds listed, other files ignored");
  assert.deepEqual([0, 1, 2, 3].map((i) => sfxVariant(["a", "b", "c"], i)), ["a", "b", "c", "a"]);
  const dinged = buildPlan(input);
  const numberCards = dinged.cards.filter((c) => c.kind === "number");
  assert.ok(numberCards.length >= 1, "the script says a number");
  for (const c of numberCards) assert.ok(dinged.sfx.some((s) => s.kind === "ding" && Math.abs(s.at - c.start) < 0.01), "a ding on each number card");
  assert.ok(!dinged.sfx.some((s) => s.kind === "pop" && numberCards.some((c) => Math.abs(s.at - c.start) < 0.01)), "no pop on a number card");
  console.log("sound library passed:", dinged.sfx.map((s) => s.kind).join(" "));
}

// ---------- Google reviews, and cards behind the head in a wide shot ----------
{
  const CLINIC =
    "Seattle, your hairline should fit your face. I'm Dr. Sam from Lee Hair Clinic. Every hairline is designed by a surgeon. We have 212 five-star reviews on Google from real patients. This month your consultation is free. Tap Learn More to book your free consultation.";
  const cw = transcript(CLINIC);
  const clinic: EditInput = {
    words: cw, sourceSeconds: cw.at(-1)!.end + 0.6, sourceHeight: 1080, face: { x: 360, y: 430, w: 360, h: 430 }, broll: 0,
    hook: null, towns: ["Seattle"], deals: [], offer: "free consultation", certifications: [], license: null, warranties: [],
    names: ["Lee Hair Clinic", "Seattle"], hasLogo: false, person: { name: "Dr. Sam", role: "Surgeon" }, company: "Lee Hair Clinic",
  };
  const close = buildPlan(clinic);
  const rev = close.cards.find((c) => c.kind === "reviews");
  assert.ok(rev, `a reviews card when they mention reviews: ${JSON.stringify(close.cards.map((c) => [c.kind, c.text]))}`);
  assert.equal(rev!.text, "5.0", "five-star said: 5.0");
  assert.equal(rev!.sub, "212 reviews on Google", "the count they said");
  assert.ok(Math.abs(rev!.start - close.words.find((w) => w.word === "212")!.start) < 0.01, "on the count");
  assert.ok(!close.cards.some((c) => c.kind === "number" && /212/.test(c.text)), "the count isn't a second card");
  assert.equal(buildPlan({ ...clinic, reviews: { rating: 4.9, count: 340 } }).cards.find((c) => c.kind === "reviews")!.sub, "340 reviews on Google", "their real Google numbers win");
  assert.ok(!close.matte && !close.cards.some((c) => c.behind), "a close shot: nothing behind the head");

  // Standing back from the camera: a small face, room above the head
  const wideFace = { x: 470, y: 560, w: 140, h: 180 };
  const wide = buildPlan({ ...clinic, face: wideFace });
  const back = wide.cards.find((c) => c.kind === "reviews")!;
  assert.ok(back.behind && wide.matte, "a wide shot: the reviews card goes behind the head");
  assert.ok(back.box.y < wideFace.y + wideFace.h && back.box.y + back.box.h > wideFace.y, "the head covers the card's lower part");
  assert.ok(back.box.y >= SAFE.top, "still in the safe zone");
  assert.ok(!wide.cards.find((c) => c.kind === "name")!.behind && !wide.cards.find((c) => c.kind === "cta")!.behind, "the name tag and call to action stay in front");
  assert.ok(fixPlan(wide, { face: wideFace, names: clinic.names, sourceWords: cw }).checks.every((c) => c.pass), "every check passes with a card behind the head");
  const wideHtml = buildComposition(wide, brand, { headingWeights: [800], bodyWeights: [400], hasLogo: false, brollCount: 0 });
  assert.match(wideHtml, /<video id="cut" src="\.\/person\.webm"/, "the cut-out of the person is drawn over it");
  assert.match(wideHtml, new RegExp(`id="cut"[^>]*data-start="${Number(back.start.toFixed(3))}" data-duration="${Number((back.end - back.start).toFixed(3))}"`), "and plays only while the card is up");
  assert.ok(wideHtml.indexOf('class="card reviews"') < wideHtml.indexOf('id="cut"') && wideHtml.indexOf('id="cut"') < wideHtml.indexOf('id="loopframe"'), "card, then the person, inside the camera");
  assert.match(wideHtml, /tl\.set\("#cutwrap",\{autoAlpha:0\}/, "the cut-out goes away with the card");
  // A face high in the frame leaves no room above it: the card goes on the torso
  assert.ok(!buildPlan({ ...clinic, face: { ...wideFace, y: 240 } }).cards.some((c) => c.behind), "no room above the head: in front");
  // Never static: taps, drops, emojis; and no riser at the end
  assert.ok(!close.sfx.some((x) => x.kind === "riser") && !buildPlan(input).sfx.some((x) => x.kind === "riser"), "never a riser");
  assert.ok(rev!.taps?.length === 1 && rev!.taps[0] > rev!.start && rev!.taps[0] < rev!.end, "the reviews card gets tapped while it's up");
  const ctaCard = close.cards.find((c) => c.kind === "cta")!;
  assert.ok((ctaCard.taps?.length ?? 0) >= 1 && ctaCard.taps!.every((t) => t < close.loopFrom), "the call to action gets tapped before the loop");
  for (const t of [...rev!.taps!, ...ctaCard.taps!]) assert.ok(close.sfx.some((x) => Math.abs(x.at - t) < 0.4), "a sound on each tap");
  assert.ok(close.cards.some((c) => c.drop), "some cards drop in");
  assert.ok(!close.cards.some((c) => c.drop && c.kind === "cta"), "the call to action slides up instead");
  const closeHtml = buildComposition(close, brand, { headingWeights: [800], bodyWeights: [400], hasLogo: false, brollCount: 0 });
  assert.match(closeHtml, /class="cursor"/, "a cursor on tapped cards");
  assert.match(closeHtml, /ease:"bounce\.out"/, "dropped cards bounce");
  assert.equal(emojiFor("Seattle", ["Seattle"]), "📍");
  assert.equal(emojiFor("listen"), "👂");
  assert.equal(emojiFor("the"), null);
  assert.ok(close.captions.some((c) => c.emoji), "emojis on some captions");
  const emo = close.captions.filter((c) => c.emoji).map((c) => c.words[c.emoji!.word].start);
  assert.ok(emo.every((t, i) => i === 0 || t - emo[i - 1] >= 1.8), "emojis spaced out");
  assert.match(closeHtml, /class="emo"/);
  // A selfie: cards go above the head and the captions keep showing under them
  const selfieFace = { x: 200, y: 560, w: 580, h: 740 };
  const sf = fixPlan(buildPlan({ ...clinic, face: selfieFace }), { face: selfieFace, names: clinic.names, sourceWords: cw });
  for (const c of sf.checks) assert.ok(c.pass, `selfie ${c.name}: ${c.detail}`);
  const sfRev = sf.plan.cards.find((c) => c.kind === "reviews")!;
  assert.ok(sfRev.box.y + sfRev.box.h <= sf.plan.captionBox.y, "the reviews card sits above the captions");
  assert.ok(sf.plan.captions.some((c) => c.start < sfRev.end && sfRev.start < c.end), "captions keep showing while it's up");
  console.log("reviews and behind-the-head passed");
}
