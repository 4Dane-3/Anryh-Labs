// The edit plan for a Migz video ad: every cut, framing, push-in, caption, card, cut-away and sound effect, each
// on its word. Pure: the app builds and checks it, the render worker draws it (HyperFrames) and mixes it
// (ffmpeg). The rules are written out in docs/migz-video-edit.md.
import { cleanTakes, editedLength, fixNames, retime, spokenNumber, tightCut, type Segment, type Word } from "@/lib/edit/words";

export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** Nothing in the top 220px, the bottom 420px or the right 140px. */
export const SAFE = { left: 60, top: 220, right: W - 140, bottom: H - 420 };
const COL = { x: 80, w: SAFE.right - 80 }; // the text column inside the safe zone
const LOOP_SECONDS = 10 / FPS; // the closing frames that match frame 0
const PUSH_SECONDS = 0.4;
const CARD_SECONDS = 1.8;
const NUMBER_SECONDS = 1.4;
const BROLL_SECONDS = 2.2;
const MIN_GAP = 0.3; // two effects never start closer than this
export const CAPTION_PX = 76;
const CAPTION_CHARS = 16; // a caption longer than this splits (2 lines at most)

export type Box = { x: number; y: number; w: number; h: number };
export type Framing = "wide" | "close";
export type CardKind = "town" | "cert" | "license" | "warranty" | "number" | "cta";
export type SfxKind = "click" | "whoosh" | "pop" | "swoosh" | "riser" | "hit";

export type EditInput = {
  words: Word[]; // the talking video's transcript, source seconds
  sourceSeconds: number;
  sourceHeight: number; // 720 or 1080: caps the close framing
  face: Box | null; // the face in the 1080x1920 frame at 100%, from one frame of the talking video
  broll: number; // job clips available
  hook: string | null; // the on-screen callout ("Kenmore homeowners")
  towns: string[];
  deals: string[];
  certifications: string[];
  license: string | null;
  warranties: string[];
  names: string[]; // every name and brand, spelled as given (company, person, towns, certifications)
  hasLogo: boolean;
};

export type Effect = { kind: "framing" | "push" | "card" | "broll" | "captions-on"; start: number; anchor: number; priority: number };

export type EditPlan = {
  fps: number;
  width: number;
  height: number;
  seconds: number; // edited length
  segments: Segment[]; // the source stretches kept, in order (the worker cuts these)
  words: Word[]; // edited timeline, names fixed
  eye: { x: number; y: number }; // zoom centre
  closeScale: number;
  framings: { start: number; framing: Framing }[]; // the framing from this moment (on cuts and punch-ins)
  pushes: { start: number; from: number; to: number }[]; // smooth push-ins and pull-outs, PUSH_SECONDS each
  hook: { text: string; accent: string | null; box: Box; end: number } | null;
  captionsFrom: number;
  captionBox: Box; // where captions sit (lower middle, clear of the face)
  captions: { start: number; end: number; words: Word[] }[];
  cards: { kind: CardKind; text: string; sub: string | null; start: number; end: number; anchor: number; box: Box }[];
  broll: { index: number; start: number; end: number; anchor: number }[];
  sfx: { kind: SfxKind; at: number }[];
  loopFrom: number; // from here to the end, the picture is frame 0 again
  musicEnd: number; // music ends cleanly on the last word
  effects: Effect[]; // every change on screen, for the checks
};

const q = (t: number) => Math.round(t * FPS) / FPS; // on the frame grid
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%]/g, "");

/** Rough text height at a size in the column, for layout and the checks (the browser does the real wrapping). */
export function textHeight(text: string, px: number, width = COL.w, lineHeight = 1.1, charWidth = 0.6) {
  const perLine = Math.max(1, Math.floor(width / (px * charWidth)));
  const lines = Math.ceil(Math.max(1, text.length) / perLine);
  return Math.ceil(lines * px * lineHeight);
}

/** A box scaled by `s` around the eye (where every zoom is centred). */
export function scaleBox(b: Box, eye: { x: number; y: number }, s: number): Box {
  return { x: eye.x + (b.x - eye.x) * s, y: eye.y + (b.y - eye.y) * s, w: b.w * s, h: b.h * s };
}

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function find(words: Word[], phrase: string, from = 0) {
  const target = phrase.split(/\s+/).map(clean).filter(Boolean);
  if (!target.length) return -1;
  for (let i = from; i < words.length; i++) {
    if (target.every((t, k) => clean(words[i + k]?.word ?? "") === t)) return i;
  }
  return -1;
}

/** The word that names a certification: its most distinctive part ("ShingleMaster", "Master Elite", "GAF"). */
function certWord(words: Word[], cert: string, from: number) {
  const whole = find(words, cert, from);
  if (whole >= 0) return whole;
  const generic = /^(certified|certification|roofer|roofing|contractor|preferred|master|elite|rated|licensed|insured|and|the|a)$/i;
  const parts = cert.split(/[\s&+]+/).filter((p) => p.length >= 3 && !generic.test(p));
  for (const p of parts) {
    const i = find(words, p, from);
    if (i >= 0) return i;
  }
  return /licensed/i.test(cert) ? find(words, "licensed", from) : -1;
}

/** The deal that matches a spoken number ($500 said -> "$500 off a full replacement"), split into big and small. */
function dealFor(deals: string[], value: number) {
  const d = deals.find((x) => (x.replace(/,/g, "").match(/\d+/g) ?? []).map(Number).includes(value));
  if (!d) return null;
  const m = d.match(/^(.*?\d[\d,]*%?\+?\s*(?:off|back|years?|-year)?)\s*(.*)$/i);
  return { big: (m?.[1] ?? d).toUpperCase(), sub: m?.[2] || null };
}

function numberText(n: { value: number; unit: string | null; plus: boolean }) {
  const v = n.value.toLocaleString("en-US");
  if (n.unit === "dollars") return `$${v}${n.plus ? "+" : ""}`;
  if (n.unit === "percent") return `${v}%`;
  if (n.unit === "years") return `${v}${n.plus ? "+" : ""} ${n.value === 1 ? "YEAR" : "YEARS"}`;
  return null; // a bare number ("one honest reason") isn't worth a graphic
}

const BROLL_WORDS = /^(leaks?|leaking|moss|granules?|shingles?|curling|gutters?|replacement|replace|inspections?|inspect|crew|install(ed|ing)?|storms?|winter|rain|attic|ceiling|stains?|flashing|roofs?)$/;

/** The edit for one talking video. Effects are placed by priority: cards and numbers, then cut-aways, then zooms. */
export function buildPlan(input: EditInput): EditPlan {
  // 1-2. Takes and the tight cut
  // Only words inside the source (a transcript can run a hair past the end)
  const takes = cleanTakes(input.words.filter((w) => w.start >= 0 && w.end <= input.sourceSeconds + 0.05 && w.end > w.start));
  const segments = tightCut(takes, FPS, input.sourceSeconds);
  const words = fixNames(retime(takes, segments), input.names).map((w) => ({ ...w, start: q(w.start), end: q(w.end) }));
  const seconds = q(editedLength(segments));
  const lastWord = words.at(-1)?.end ?? seconds;

  // 4. Zooms centre on the eyes (a little above the middle of the face)
  const face = input.face;
  const eye = face ? { x: face.x + face.w / 2, y: face.y + face.h * 0.42 } : { x: W / 2, y: H * 0.36 };
  const closeScale = input.sourceHeight >= 1080 ? 1.15 : 1.1;
  const scaleOf = (f: Framing) => (f === "close" ? closeScale : 1);

  // 6. The hook: on screen from frame 0, until the first sentence ends; then captions take over
  const firstEnd = words.findIndex((w, i) => /[.!?]$/.test(w.word) || i === words.length - 1);
  const captionsFrom = q(Math.min(words[Math.max(0, firstEnd)]?.end ?? 2.5, 3.5));
  const faceAt = (s: number) => (face ? scaleBox(face, eye, s) : null);
  const maxFace = faceAt(closeScale * 1.08);
  const hookText = input.hook?.trim() || null;
  const hookPx = 84;
  const hookH = hookText ? textHeight(hookText.toUpperCase(), hookPx, COL.w, 1.05, 0.74) + 40 : 0;
  const topRoom = (maxFace ? maxFace.y : H * 0.3) - 24 - SAFE.top;
  // Captions in the lower middle, under the face; above it only if the face sits too low
  const capH = Math.ceil(2 * CAPTION_PX * 1.08) + 20; // room for two lines
  const capTop = Math.max(maxFace ? maxFace.y + maxFace.h + 32 : H * 0.58, H * 0.56);
  const captionBox: Box = capTop + capH <= SAFE.bottom - 180 ? { x: COL.x, y: capTop, w: COL.w, h: capH } : { x: COL.x, y: SAFE.bottom - 180 - capH, w: COL.w, h: capH };
  const cardBand: Box = { x: COL.x, y: captionBox.y + captionBox.h + 16, w: COL.w, h: Math.max(120, SAFE.bottom - (captionBox.y + captionBox.h + 16)) };
  const hook = hookText
    ? {
        text: hookText,
        accent: input.towns.find((t) => hookText.toLowerCase().includes(t.toLowerCase())) ?? null,
        box: hookH <= topRoom ? { x: COL.x, y: SAFE.top, w: COL.w, h: hookH } : { x: COL.x, y: captionBox.y, w: COL.w, h: hookH },
        end: captionsFrom,
      }
    : null;

  const effects: Effect[] = [];
  const taken = (t: number, gap = MIN_GAP) => effects.some((e) => Math.abs(e.start - t) < gap);
  const add = (e: Effect) => effects.push(e);
  add({ kind: "framing", start: 0, anchor: 0, priority: 5 });
  if (hook) add({ kind: "captions-on", start: captionsFrom, anchor: captionsFrom, priority: 4 });

  // The call to action: from "Tap" (or "Learn More") to the loop
  const loopFrom = q(seconds - LOOP_SECONDS);
  let ctaAt = find(words, "tap learn more");
  if (ctaAt < 0) ctaAt = find(words, "learn more");
  // At least 1.5s on screen: when "Tap" comes later than that, the card starts on an earlier word
  const ctaLatest = loopFrom - 1.5;
  const ctaStart = ctaAt >= 0 && words[ctaAt].start <= ctaLatest ? words[ctaAt].start : (words.filter((w) => w.start <= Math.min(ctaLatest, ctaAt >= 0 ? words[ctaAt].start : lastWord - 2.5) && w.start > captionsFrom).at(-1)?.start ?? q(ctaLatest));
  const cards: EditPlan["cards"] = [];
  const busy = (s: number, e: number) => cards.some((c) => s < c.end && c.start < e);
  const placeCard = (kind: CardKind, text: string, sub: string | null, at: number, len: number) => {
    const start = words[at].start;
    const end = q(Math.min(start + len, ctaStart - 0.15));
    if (start < captionsFrom || taken(start) || busy(start, end) || end - start < 0.8) return false;
    const big = kind === "number";
    const h = big ? Math.min(cardBand.h + captionBox.h, textHeight(text, 150) + (sub ? 70 : 0) + 30) : textHeight(text, 58) + (sub ? 50 : 0) + 96;
    const box: Box = big ? { x: COL.x, y: captionBox.y, w: COL.w, h } : { x: COL.x, y: cardBand.y, w: COL.w, h: Math.min(h, cardBand.h) };
    cards.push({ kind, text, sub, start, end, anchor: start, box });
    add({ kind: "card", start, anchor: start, priority: 1 });
    return true;
  };

  cards.push({ kind: "cta", text: "Tap Learn More", sub: "Free roof inspection", start: ctaStart, end: loopFrom, anchor: ctaStart, box: { x: COL.x, y: captionBox.y, w: COL.w, h: Math.min(SAFE.bottom - captionBox.y, 330) } });
  add({ kind: "card", start: ctaStart, anchor: ctaStart, priority: 0 });

  // Numbers said out loud, as big kinetic text (the offer's own wording when it's the deal)
  for (let i = 0; i < words.length; i++) {
    const n = spokenNumber(words, i);
    if (!n) continue;
    const deal = n.unit === "dollars" || n.unit === "percent" ? dealFor(input.deals, n.value) : null;
    const text = deal?.big ?? numberText(n);
    if (text) placeCard("number", text, deal?.sub ?? null, i, NUMBER_SECONDS);
    i = n.last;
  }
  // Credentials, on the word that names them
  for (const c of input.certifications) {
    const at = certWord(words, c, 0);
    if (at >= 0) placeCard(/licensed/i.test(c) ? "license" : "cert", c, /licensed/i.test(c) ? (input.license ?? null) : "Certified", at, CARD_SECONDS);
  }
  const lic = find(words, "licensed");
  if (lic >= 0 && !cards.some((c) => c.kind === "license")) placeCard("license", "Licensed & insured", input.license, lic, CARD_SECONDS);
  const war = Math.max(find(words, "warranty"), find(words, "guarantee"), find(words, "warranties"));
  if (war >= 0 && input.warranties.length) placeCard("warranty", input.warranties[0], null, war, CARD_SECONDS);
  // Towns said after the hook (the hook already shows the ones it names)
  for (const t of input.towns) {
    const at = find(words, t, words.findIndex((w) => w.start >= captionsFrom));
    if (at >= 0 && !(hookText ?? "").toLowerCase().includes(t.toLowerCase())) placeCard("town", t, null, at, CARD_SECONDS);
  }

  // A deal said too close to the end for its own card goes on the last card instead
  const cta = cards.find((c) => c.kind === "cta")!;
  const dealSaid = words.some((w, i) => {
    const n = spokenNumber(words, i);
    return n && (n.unit === "dollars" || n.unit === "percent") && !!dealFor(input.deals, n.value);
  });
  if (dealSaid && !cards.some((c) => c.kind === "number" && input.deals.some((d) => d.toUpperCase().startsWith(c.text)))) cta.sub = input.deals.find((d) => /\d/.test(d)) ?? cta.sub;

  // Cut-aways to the job clips on the words about the roof or the work, then spread over what's left
  const broll: EditPlan["broll"] = [];
  const clear = (s: number, e: number) => !busy(s, e) && !broll.some((b) => s < b.end + 0.6 && b.start < e + 0.6) && s >= captionsFrom + 0.6 && e <= ctaStart - 0.4;
  for (const w of words) {
    if (broll.length >= input.broll) break;
    if (!BROLL_WORDS.test(clean(w.word)) || taken(w.start)) continue;
    const end = q(w.start + BROLL_SECONDS);
    if (!clear(w.start, end)) continue;
    broll.push({ index: broll.length, start: w.start, end, anchor: w.start });
    add({ kind: "broll", start: w.start, anchor: w.start, priority: 2 });
  }
  for (const w of words) {
    if (broll.length >= input.broll) break;
    const end = q(w.start + BROLL_SECONDS);
    if (taken(w.start, 1.2) || !clear(w.start, end)) continue;
    // Keep them apart: at most one cut-away in any 4 seconds
    if (broll.some((b) => Math.abs(b.start - w.start) < 4)) continue;
    broll.push({ index: broll.length, start: w.start, end, anchor: w.start });
    add({ kind: "broll", start: w.start, anchor: w.start, priority: 2 });
  }
  broll.sort((a, b) => a.start - b.start).forEach((b, i) => (b.index = i));

  // Jump cuts: every segment boundary; the framing alternates on each, unless a card owns that beat
  const framings: EditPlan["framings"] = [{ start: 0, framing: "close" }]; // frame 0: a punch-in, never a static wide
  let edited = 0;
  for (const s of segments.slice(0, -1)) {
    edited += s.to - s.from;
    const t = q(edited);
    if (t >= loopFrom || t < 0.2) continue;
    const prev = framings.at(-1)!.framing;
    if (taken(t)) continue; // the beat already has its effect; the cut keeps the framing
    framings.push({ start: t, framing: prev === "close" ? "wide" : "close" });
    add({ kind: "framing", start: t, anchor: t, priority: 3 });
  }

  // Push-ins on emphasis words, and changes wherever nothing has happened for too long
  const pushes: EditPlan["pushes"] = [];
  const coveredByOverlay = (t: number) => broll.some((b) => t >= b.start && t < b.end) || cards.some((c) => c.kind === "cta" && t >= c.start);
  const tryPush = (w: Word) => {
    if (taken(w.start) || coveredByOverlay(w.start) || w.start >= loopFrom - PUSH_SECONDS) return false;
    const from = scaleAt({ framings, pushes, closeScale }, w.start);
    const zoomIn = from < closeScale * 1.05;
    const to = zoomIn ? Math.min(from * 1.06, closeScale * 1.08) : scaleOf("wide");
    // Never two zooms in a row (the previous change was a push)
    const prevChange = [...effects].filter((e) => e.start < w.start).sort((a, b) => b.start - a.start)[0];
    if (prevChange?.kind === "push") return false;
    pushes.push({ start: w.start, from, to });
    add({ kind: "push", start: w.start, anchor: w.start, priority: 3 });
    return true;
  };
  const emphasis = (w: Word) => /\d/.test(w.word) || /^(free|today|now|small|straight|plainly|honest|years?)$/.test(clean(w.word)) || input.towns.some((t) => clean(t) === clean(w.word));
  for (const w of words) if (emphasis(w) && w.start > captionsFrom) tryPush(w);
  // Opening: something changes every 1 to 1.5 seconds until 3s; after that never 4s without a change
  for (const [limit, until] of [
    [1.5, 3],
    [3.8, loopFrom],
  ] as const) {
    let guard = 0;
    for (;;) {
      if (guard++ > 60) break;
      const starts = [...new Set([0, ...effects.map((e) => e.start)])].filter((t) => t < until).sort((a, b) => a - b);
      const gapAt = starts.findIndex((t, k) => (starts[k + 1] ?? until) - t > limit && !coveredByOverlay(t + 0.1));
      if (gapAt < 0) break;
      const from = starts[gapAt];
      const to = starts[gapAt + 1] ?? until;
      // The word starting nearest the middle of the gap (a framing punch inside a sentence, or a push)
      const mid = from + Math.min(limit, (to - from) / 2);
      const cands = words.filter((w) => w.start > from + MIN_GAP && w.start < to - MIN_GAP).sort((a, b) => Math.abs(a.start - mid) - Math.abs(b.start - mid));
      let placed = false;
      const punch = (w: Word) => {
        if (taken(w.start) || coveredByOverlay(w.start)) return false;
        const prev = framings.filter((f) => f.start <= w.start).at(-1)!.framing;
        framings.push({ start: w.start, framing: prev === "close" ? "wide" : "close" });
        framings.sort((a, b) => a.start - b.start);
        add({ kind: "framing", start: w.start, anchor: w.start, priority: 3 });
        return true;
      };
      for (const w of cands) {
        // Vary the move: framing cuts in the opening, then alternate with push-ins (never two zooms in a row)
        const preferPunch = until <= 3 || pushes.length % 2 === 1;
        placed = preferPunch ? punch(w) || tryPush(w) : tryPush(w) || punch(w);
        if (placed) break;
      }
      if (!placed) break; // a long word or silence: nothing to anchor a change to
    }
  }
  pushes.sort((a, b) => a.start - b.start);

  // 5. Captions: 2 to 4 words, from the end of the hook until the call to action, hidden under the big numbers
  const captions: EditPlan["captions"] = [];
  let cur: Word[] = [];
  const shown = words.filter((w) => w.start >= captionsFrom - 0.01 && w.start < ctaStart);
  shown.forEach((w, i) => {
    cur.push(w);
    const next = shown[i + 1];
    const stop = /[.!?,]$/.test(w.word) || (next && next.start - w.end > 0.25);
    const long = (cur.map((x) => x.word).join(" ") + (next ? ` ${next.word}` : "")).length > CAPTION_CHARS;
    if (cur.length >= 4 || /[.!?]$/.test(w.word) || (stop && cur.length >= 2) || !next || (long && cur.length >= 1)) {
      captions.push({ start: cur[0].start, end: q(next ? next.start : Math.min(w.end + 0.3, ctaStart)), words: cur });
      cur = [];
    }
  });
  const numberCards = cards.filter((c) => c.kind === "number");
  const visibleCaptions = captions.filter((c) => !numberCards.some((n) => c.start < n.end && n.start < c.end));

  // 8. Sound: restrained, only on beats (a click on cuts in the opening, whooshes on every other push)
  const sfx: EditPlan["sfx"] = [{ kind: "hit", at: 0 }];
  framings.slice(1).forEach((f) => f.start <= 3.2 && sfx.push({ kind: "click", at: f.start }));
  pushes.forEach((p, i) => i % 2 === 0 && sfx.push({ kind: "whoosh", at: p.start }));
  cards.forEach((c) => c.kind !== "cta" && sfx.push({ kind: "pop", at: c.start }));
  broll.forEach((b) => sfx.push({ kind: "swoosh", at: b.start }));
  sfx.push({ kind: "riser", at: q(Math.max(0, ctaStart - 0.6)) });
  // Never two sounds closer than 0.4s (the earlier, more important one stays)
  const order: SfxKind[] = ["hit", "riser", "pop", "swoosh", "click", "whoosh"];
  const chosen: EditPlan["sfx"] = [];
  for (const s of [...sfx].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) if (!chosen.some((c) => Math.abs(c.at - s.at) < 0.4)) chosen.push(s);

  return {
    fps: FPS,
    width: W,
    height: H,
    seconds,
    segments,
    words,
    eye,
    closeScale,
    framings: framings.sort((a, b) => a.start - b.start),
    pushes,
    hook,
    captionsFrom: hook ? captionsFrom : 0,
    captionBox,
    captions: visibleCaptions,
    cards: cards.sort((a, b) => a.start - b.start),
    broll,
    sfx: chosen.sort((a, b) => a.at - b.at),
    loopFrom,
    musicEnd: q(Math.min(seconds, lastWord + 0.25)),
    effects: effects.sort((a, b) => a.start - b.start),
  };
}

/** The zoom at a moment: the framing in force plus any push since it. */
export function scaleAt(plan: Pick<EditPlan, "framings" | "pushes" | "closeScale">, t: number) {
  const f = plan.framings.filter((x) => x.start <= t).at(-1);
  let s = f?.framing === "close" ? plan.closeScale : 1;
  for (const p of plan.pushes) {
    if (p.start > t || (f && p.start < f.start)) continue;
    const k = Math.min(1, (t - p.start) / PUSH_SECONDS);
    s = p.from + (p.to - p.from) * k;
  }
  return s;
}
