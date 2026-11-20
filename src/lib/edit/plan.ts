// The edit plan for a Migz video ad: every cut, framing, push-in, caption, card, cut-away and sound effect, each
// on its word. Pure: the app builds and checks it, the render worker draws it (HyperFrames) and mixes it
// (ffmpeg). The rules are written out in docs/migz-video-edit.md.
import { kindsForWord } from "@/lib/roofing/job-media";
import { pickEmojis } from "@/lib/edit/emoji";
import { cleanTakes, editedLength, fixNames, retime, spokenNumber, tightCut, type Segment, type Word } from "@/lib/edit/words";

export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** Nothing in the top 220px, the bottom 420px or the right 140px. */
export const SAFE = { left: 60, top: 220, right: W - 140, bottom: H - 420 };
const COL = { x: 80, w: SAFE.right - 80 }; // the text column inside the safe zone
const LOOP_SECONDS = 10 / FPS; // the closing frames that match frame 0
const PUSH_SECONDS = 0.4;
const CARD_SECONDS = 2.2; // long enough for a card to land and get tapped
const NUMBER_SECONDS = 1.4;
const BROLL_SECONDS = 1.8;
const MIN_GAP = 0.3; // two effects never start closer than this
export const CAPTION_PX = 76;
const CAPTION_CHARS = 16; // a caption longer than this splits (2 lines at most)

export type Box = { x: number; y: number; w: number; h: number };
export type Framing = "wide" | "close";
export type CardKind = "town" | "cert" | "license" | "warranty" | "number" | "name" | "reviews" | "cta";
export type SfxKind = "click" | "whoosh" | "pop" | "swoosh" | "riser" | "hit" | "ding";

export type EditInput = {
  words: Word[]; // the talking video's transcript, source seconds
  sourceSeconds: number;
  sourceHeight: number; // 720 or 1080: caps the close framing
  face: Box | null; // the face in the 1080x1920 frame at 100%, from one frame of the talking video
  broll: number; // job clips available
  brollKinds?: (string | null)[]; // what each clip shows ("crew", "inspection"...), to cut to the one that fits the word
  hook: string | null; // the on-screen callout ("Kenmore homeowners")
  audience?: string | null; // who the hook calls out when it's shortened to "<town> <audience>" (default "homeowners")
  towns: string[];
  deals: string[];
  offer?: string | null; // what the ads offer ("free roof inspection" or "free quote"), for the last card
  certifications: string[];
  license: string | null;
  warranties: string[];
  names: string[]; // every name and brand, spelled as given (company, person, towns, certifications)
  hasLogo: boolean;
  person?: { name: string; role: string | null } | null; // who's on camera: a name tag when they say their name
  company?: string | null;
  area?: string | null; // "Bothell, WA": the line under the name tag
  reviews?: { rating: number | null; count: number | null } | null; // their Google rating, for the reviews card
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
  // When the face fills the frame (a close selfie), the talking video is shrunk toward the top over a blurred
  // copy of itself, so captions and cards have room under the chin. null = full frame.
  fit: { scale: number; origin: { x: number; y: number } } | null; // no longer used: the video always fills the frame
  selfie: boolean; // the face fills the frame: a gentler zoom, captions over the chin, cards above the head
  chin: number; // in a selfie, the share of the face (from the bottom) captions may cover; 0 otherwise
  framings: { start: number; framing: Framing }[]; // the framing from this moment (on cuts and punch-ins)
  pushes: { start: number; from: number; to: number }[]; // smooth push-ins and pull-outs, PUSH_SECONDS each
  hook: { text: string; accent: string | null; box: Box; end: number; pins?: string[] } | null;
  captionsFrom: number;
  captionBox: Box; // where captions sit (lower middle, clear of the face)
  captions: { start: number; end: number; words: Word[]; emoji?: { word: number; char: string } }[]; // emoji: pops beside that word
  // behind: the card sits behind their head (a wide shot, where the person is small enough to leave room above them)
  // drop: falls in from the top and bounces to rest; taps: when a cursor taps it (a click sound plays)
  cards: { kind: CardKind; text: string; sub: string | null; start: number; end: number; anchor: number; box: Box; behind?: boolean; drop?: boolean; taps?: number[] }[];
  matte: boolean; // a card goes behind the person, so the worker cuts them out of the talking video
  face: Box | null; // the face at 100% (the name tag's focus brackets follow it through the zooms)
  company: string | null;
  area: string | null;
  offer: string; // "free roof inspection" or "free quote"
  broll: { index: number; start: number; end: number; anchor: number; clip?: number }[]; // clip: which job clip (default: index)
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

/** A box (already zoomed) where it lands after the shrink-to-fit, if any. */
export const fitBox = (b: Box, fit: EditPlan["fit"]) => (fit ? scaleBox(b, fit.origin, fit.scale) : b);

/** Smallest the talking video is shrunk to; below this the person is too small to carry the ad. */
export const MIN_FIT = 0.6;
/** In a selfie, captions may cover this much of the bottom of the face (the chin). */
export const CHIN = 0.15;
export const MAX_CHIN = 0.3;
export const HOOK_PX = 84;

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

/** Cards that can sit behind the head in a wide shot (the name tag and the call to action stay in front). */
const BEHIND_KINDS: CardKind[] = ["reviews", "number", "cert", "license", "warranty", "town"];
/** A face this small (share of the frame's height) is a wide shot: standing, or sitting back from the camera. */
export const WIDE_FACE = 0.13;
/** Cards a cursor taps, like a button on a phone. */
const TAPPABLE: CardKind[] = ["reviews", "cta", "cert", "license", "warranty"];
const REVIEW_WORDS = /^(reviews?|fivestar|5star|google)$/; // after clean(): "five-star" is "fivestar"

const BROLL_WORDS = /^(leaks?|leaking|moss|granules?|shingles?|curling|gutters?|replacement|replace|inspections?|inspect|crew|install(ed|ing)?|storms?|winter|rain|attic|ceiling|stains?|flashing|roofs?|clinic|consult(ation)?s?|procedures?|transplants?|hairline|grafts?|surgeons?|surgery)$/;

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
  const fullClose = input.sourceHeight >= 1080 ? 1.15 : 1.1;

  // 6. The hook: on screen from frame 0, until the first sentence ends; then captions take over
  const firstEnd = words.findIndex((w, i) => /[.!?:]$/.test(w.word) || i === words.length - 1); // "Kenmore homeowners:" ends the hook too
  const hookEnd = q(Math.min(words[Math.max(0, firstEnd)]?.end ?? 2.5, 3.5));
  // The hook as typed, or (when it won't fit in two lines) its first town plus who it calls out ("homeowners")
  const hookLines = (t: string) => Math.round(textHeight(t.toUpperCase(), HOOK_PX, COL.w, 1.05, 0.74) / (HOOK_PX * 1.05));
  const typed = input.hook?.trim() || null;
  const firstTown = typed ? input.towns.find((t) => typed.toLowerCase().includes(t.toLowerCase())) : undefined;
  const hookText = typed && hookLines(typed) > 2 && firstTown ? `${firstTown} ${input.audience?.trim() || "homeowners"}` : typed;
  // Without a hook the captions carry the opening line from the first word
  const captionsFrom = hookText ? hookEnd : 0;
  // With towns in it, the hook is a stack of map-pin tags (up to 3) under one light line; otherwise big text
  const pinTowns = hookText ? input.towns.slice(0, 3) : [];
  const pinned = !!hookText && pinTowns.some((t) => hookText.toLowerCase().includes(t.toLowerCase()));
  const hookH = !hookText ? 0 : pinned ? 76 + pinTowns.length * 92 : textHeight(hookText.toUpperCase(), HOOK_PX, COL.w, 1.05, 0.74) + 40;
  const capH = Math.ceil(2 * CAPTION_PX * 1.08) + 20; // room for two lines

  // The video always fills the frame (never shrunk over a blurred copy with borders). A selfie, where the face is too
  // big for text to fit under it at full zoom, zooms in less, and its captions may sit over the chin (the lowest 15%
  // of the face), never higher
  const band = Math.max(capH, hookH);
  const selfie = !!face && scaleBox(face, eye, fullClose * 1.08).y + scaleBox(face, eye, fullClose * 1.08).h + 32 + band > SAFE.bottom;
  const closeScale = selfie ? 1.08 : fullClose;
  const scaleOf = (f: Framing) => (f === "close" ? closeScale : 1);
  const fit: EditPlan["fit"] = null;
  const faceAt = (s: number) => (face ? scaleBox(face, eye, s) : null);
  const maxFace = faceAt(closeScale * 1.08);
  const topRoom = (maxFace ? maxFace.y : H * 0.3) - 24 - SAFE.top;
  // Captions in the lower middle, under the face (over the chin in a selfie); they stay on screen while cards are up
  // How much of the chin they may cover: 15%, more (up to 30%) only when the face is so big that's the only fit
  const zMax = closeScale * 1.08;
  const lowestCapTop = SAFE.bottom - capH - 16;
  const chin = selfie && face ? Math.min(MAX_CHIN, Math.max(CHIN, 1 - ((eye.y + (lowestCapTop - eye.y) / zMax) - face.y) / face.h)) : 0;
  const chinFree = face ? scaleBox({ ...face, h: face.h * (1 - chin) }, eye, zMax) : null;
  const under = !face || !maxFace ? H * 0.58 : selfie ? chinFree!.y + chinFree!.h + 16 : maxFace.y + maxFace.h + 32;
  const captionBox: Box = { x: COL.x, y: Math.min(Math.max(under, H * 0.56), SAFE.bottom - capH), w: COL.w, h: capH };
  const cardBand: Box = { x: COL.x, y: captionBox.y + captionBox.h + 16, w: COL.w, h: Math.max(0, SAFE.bottom - (captionBox.y + captionBox.h + 16)) };
  // Above the head when there's room; else in the caption band, with only as many town pins as fit there
  const hookUp = hookH <= topRoom;
  const bandRoom = SAFE.bottom - captionBox.y;
  const pinsFit = hookUp ? pinTowns.length : Math.min(pinTowns.length, Math.floor((bandRoom - 76) / 92));
  const keepPins = pinned && pinsFit >= 1;
  const hookBoxH = hookUp ? hookH : keepPins ? 76 + pinsFit * 92 : hookText ? Math.min(bandRoom, textHeight(hookText.toUpperCase(), HOOK_PX, COL.w, 1.05, 0.74) + 40) : 0;
  const hook = hookText
    ? {
        text: hookText,
        accent: input.towns.find((t) => hookText.toLowerCase().includes(t.toLowerCase())) ?? null,
        ...(keepPins ? { pins: pinTowns.slice(0, pinsFit) } : {}),
        box: { x: COL.x, y: hookUp ? SAFE.top : captionBox.y, w: COL.w, h: hookBoxH },
        end: hookEnd,
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
  // Where a card goes, so the captions keep showing: behind the head (a wide shot), above the head, under the
  // captions; only when none has room does it take the caption band (and the captions hide under it)
  const aboveHead = (h: number): Box | null => (topRoom >= h ? { x: COL.x, y: SAFE.top + topRoom - h, w: COL.w, h } : null);
  const belowCaptions = (h: number): Box | null => (cardBand.h >= h ? { x: COL.x, y: cardBand.y, w: COL.w, h } : null);
  // In a wide shot a card can go behind the head, like a sign on the wall behind them: centred on the head, its
  // lower part covered by it. Only when it stays in the safe zone at the biggest zoom; otherwise it goes on the torso.
  const wide = !!face && !fit && face.h <= H * WIDE_FACE;
  const behindBox = (kind: CardKind, h: number): Box | null => {
    if (!wide || !face || !BEHIND_KINDS.includes(kind)) return null;
    // It zooms with the shot (up to the close framing, a push and the cut snap), so it's sized for the biggest zoom
    const zMax = closeScale * 1.08 * 1.07;
    const w = Math.min(kind === "town" ? 620 : 760, Math.floor((SAFE.right - SAFE.left) / zMax) - 8);
    // Centred on the head, nudged in at the biggest zoom (the safe zone's right side is wider: the ad's buttons)
    const zw = w * zMax;
    const zx = Math.max(SAFE.left, Math.min(SAFE.right - zw, eye.x - zw / 2));
    const x = eye.x + (zx - eye.x) / zMax;
    // Its bottom a quarter of the way down the face: the top of the head covers the lower middle of the card
    const b: Box = { x, y: face.y + face.h * 0.25 - h, w, h };
    const zoomed = scaleBox(b, eye, zMax);
    const inside = zoomed.y >= SAFE.top && zoomed.x >= SAFE.left && zoomed.x + zoomed.w <= SAFE.right;
    return inside ? b : null;
  };
  const placeCard = (kind: CardKind, text: string, sub: string | null, at: number, len: number) => {
    const start = words[at].start;
    const end = q(Math.min(start + len, ctaStart - 0.15));
    if (start < captionsFrom || taken(start) || busy(start, end) || end - start < 0.8) return false;
    // Every card sits on the torso, like the captions (which hide under it): the offer pill, the glass cards, the name tag
    const h = kind === "number" ? (sub ? 64 : 0) + 150 : kind === "name" ? 170 : kind === "cert" ? 240 : kind === "reviews" ? 250 : kind === "cta" ? 300 : textHeight(text, 52, COL.w - 150) + 110;
    const behind = behindBox(kind, h);
    const box: Box = behind ?? aboveHead(h) ?? belowCaptions(h) ?? { x: COL.x, y: captionBox.y, w: COL.w, h: Math.min(h, SAFE.bottom - captionBox.y) };
    cards.push({ kind, text, sub, start, end, anchor: start, box, ...(behind ? { behind: true } : {}) });
    add({ kind: "card", start, anchor: start, priority: 1 });
    return true;
  };

  const offerLine = input.offer ? input.offer.charAt(0).toUpperCase() + input.offer.slice(1) : "Free roof inspection";
  cards.push({ kind: "cta", text: "Tap Learn More", sub: offerLine, start: ctaStart, end: loopFrom, anchor: ctaStart, box: { x: COL.x, y: captionBox.y, w: COL.w, h: Math.min(SAFE.bottom - captionBox.y, 330) } });
  add({ kind: "card", start: ctaStart, anchor: ctaStart, priority: 0 });

  // Their Google reviews, when they mention them ("50 five-star reviews on Google"): the card starts on the count
  const rv = words.findIndex((w) => w.start >= captionsFrom && REVIEW_WORDS.test(clean(w.word)));
  if (rv >= 0) {
    const said = spokenNumber(words, Math.max(0, rv - 1));
    const at = said && said.last >= rv - 1 ? Math.max(0, rv - 1) : rv;
    const count = input.reviews?.count ?? (said && said.last >= rv - 1 && said.value >= 5 ? said.value : null);
    const rating = input.reviews?.rating ?? (words.slice(rv, rv + 3).some((w) => /five|5/.test(clean(w.word))) ? 5 : null);
    placeCard("reviews", (rating ?? 5).toFixed(1), count ? `${count.toLocaleString("en-US")} reviews on Google` : "Reviews on Google", at, CARD_SECONDS);
  }

  // Numbers said out loud, as big kinetic text (the offer's own wording when it's the deal)
  for (let i = 0; i < words.length; i++) {
    const n = spokenNumber(words, i);
    if (!n) continue;
    const deal = n.unit === "dollars" || n.unit === "percent" ? dealFor(input.deals, n.value) : null;
    const text = deal?.big ?? numberText(n);
    // A count that's part of the reviews ("50 five-star reviews") is on the reviews card already
    const inReviews = cards.some((c) => c.kind === "reviews" && c.start === words[i].start);
    if (text && !inReviews) placeCard("number", text, deal?.sub ?? null, i, NUMBER_SECONDS);
    i = Math.max(i, n.last);
  }
  // Their name tag, when they say their name ("I'm Gil")
  if (input.person?.name) {
    const at = find(words, input.person.name.split(/\s+/)[0]);
    if (at >= 0) placeCard("name", input.person.name, input.person.role, at, CARD_SECONDS);
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

  // The current special always makes it on screen: its own card when it's said in time, else on the last card
  const cta = cards.find((c) => c.kind === "cta")!;
  const dealSaid = words.some((w, i) => {
    const n = spokenNumber(words, i);
    return n && (n.unit === "dollars" || n.unit === "percent") && !!dealFor(input.deals, n.value);
  });
  const dealCard = cards.some((c) => c.kind === "number" && input.deals.some((d) => d.toUpperCase().startsWith(c.text)));
  if (!dealCard && input.deals.length) cta.sub = (dealSaid ? input.deals.find((d) => /\d/.test(d)) : null) ?? input.deals[0];

  // Cut-aways to the job clips on the words about the roof or the work, then spread over what's left
  const broll: EditPlan["broll"] = [];
  const clear = (s: number, e: number) => !busy(s, e) && !broll.some((b) => s < b.end + 0.6 && b.start < e + 0.6) && s >= captionsFrom + 0.3 && e <= ctaStart - 0.3;
  // Each clip is used once; on a word about the roof, the clip that shows it ("inspection" cuts to an inspection)
  const used = new Set<number>();
  const clipFor = (word: string) => {
    const free = [...Array(input.broll).keys()].filter((i) => !used.has(i));
    const want = kindsForWord(word);
    const best = want.map((k) => free.find((i) => input.brollKinds?.[i] === k)).find((i) => i !== undefined);
    return best ?? free[0];
  };
  const cut = (w: Word, end: number) => {
    const clip = clipFor(w.word);
    used.add(clip);
    broll.push({ index: broll.length, start: w.start, end, anchor: w.start, clip });
    add({ kind: "broll", start: w.start, anchor: w.start, priority: 2 });
  };
  for (const w of words) {
    if (broll.length >= input.broll) break;
    if (!(BROLL_WORDS.test(clean(w.word)) || kindsForWord(w.word).some((k) => input.brollKinds?.includes(k) && k !== "team")) || taken(w.start)) continue;
    const end = q(w.start + BROLL_SECONDS);
    if (!clear(w.start, end)) continue;
    cut(w, end);
  }
  for (const w of words) {
    if (broll.length >= input.broll) break;
    const end = q(w.start + BROLL_SECONDS);
    if (taken(w.start, 0.6) || !clear(w.start, end)) continue;
    // Keep them apart: at most one cut-away in any 4 seconds
    if (broll.some((b) => Math.abs(b.start - w.start) < 4)) continue;
    cut(w, end);
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
      // A gap only counts as covered when a job clip spans all of it (or it's the last card), the same rule the
      // pacing check uses: a framing cut during a clip mustn't hide the still stretch after the clip ends
      const gapCovered = (t: number, next: number) => broll.some((b) => t >= b.start - 0.01 && next <= b.end + 0.01) || cards.some((c) => c.kind === "cta" && t >= c.start - 0.01);
      const gapAt = starts.findIndex((t, k) => (starts[k + 1] ?? until) - t > limit && !gapCovered(t, starts[k + 1] ?? until));
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
    // Never end a caption on a little word ("take a" / "look"): it goes with the word after it
    const weak = /^(a|an|the|to|of|for|your|our|my|and|or|in|on|at|with|by|is|are|it|this|that)$/.test(clean(w.word)) && !/[.!?,]$/.test(w.word);
    if (weak && next && cur.length < 4 && !long) return;
    if (cur.length >= 4 || /[.!?]$/.test(w.word) || (stop && cur.length >= 2) || !next || (long && cur.length >= 1)) {
      // A little word left at the end moves on to the next caption
      const carry = weak && next && cur.length > 1 ? [cur.pop()!] : [];
      captions.push({ start: cur[0].start, end: q(carry.length ? carry[0].start : next ? next.start : Math.min(w.end + 0.3, ctaStart)), words: cur });
      cur = carry;
    }
  });
  // Hidden under any card that sits on the caption band (the big numbers, or every card in a shrunk video)
  const overCaptions = cards.filter((c) => c.kind !== "cta" && overlaps(c.box, captionBox));
  const visibleCaptions = captions.filter((c) => !overCaptions.some((n) => c.start < n.end && n.start < c.end));

  const emojis = pickEmojis(visibleCaptions, input.towns);

  // Never static: every other card drops in from the top and bounces; cards you'd tap get tapped by a cursor
  // (the call to action every 1.4s until the loop)
  let nth = 0;
  for (const c of [...cards].sort((a, b) => a.start - b.start)) {
    if (c.kind !== "cta") {
      if (nth % 2 === 1 && !c.behind) c.drop = true;
      nth++;
    }
    if (!TAPPABLE.includes(c.kind)) continue;
    const taps: number[] = [];
    if (c.kind === "cta") for (let t = c.start + 0.7; t <= loopFrom - 0.4; t += 1.4) taps.push(q(t));
    else if (c.start + (c.drop ? 1.05 : 0.75) <= c.end - 0.35) taps.push(q(c.start + (c.drop ? 1.05 : 0.75)));
    if (taps.length) c.taps = taps;
  }

  // 8. Sound: restrained, only on beats (a click on cuts in the opening, whooshes on every other push)
  const sfx: EditPlan["sfx"] = [{ kind: "hit", at: 0 }];
  framings.slice(1).forEach((f) => f.start <= 3.2 && sfx.push({ kind: "click", at: f.start }));
  pushes.forEach((p, i) => i % 2 === 0 && sfx.push({ kind: "whoosh", at: p.start }));
  // A ding on the big numbers and the offer (the moment worth hearing), a pop on every other card
  cards.forEach((c) => c.kind !== "cta" && sfx.push({ kind: c.kind === "number" ? "ding" : "pop", at: c.start }));
  // A whip into every cut-away and back out of it, the swoosh leading the cut a little so its rush lands on it
  cards.forEach((c) => c.taps?.forEach((t) => sfx.push({ kind: "click", at: t })));
  broll.forEach((b) => {
    sfx.push({ kind: "swoosh", at: q(Math.max(0, b.start - 0.1)) });
    sfx.push({ kind: "swoosh", at: q(Math.max(0, b.end - 0.1)) });
  });
  // No riser: a build-up before the end sounds like a trailer
  // Never two sounds closer than 0.4s (the earlier, more important one stays)
  const order: SfxKind[] = ["hit", "riser", "ding", "pop", "swoosh", "click", "whoosh"];
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
    fit,
    selfie,
    chin,
    face: face ?? null,
    company: input.company ?? null,
    area: input.area ?? null,
    offer: input.offer || "free roof inspection",
    framings: framings.sort((a, b) => a.start - b.start),
    pushes,
    hook,
    captionsFrom: hook ? captionsFrom : 0,
    captionBox,
    captions: visibleCaptions.map((c, i) => (emojis[i] ? { ...c, emoji: emojis[i]! } : c)),
    cards: cards.sort((a, b) => a.start - b.start),
    broll,
    sfx: chosen.sort((a, b) => a.at - b.at),
    loopFrom,
    musicEnd: q(Math.min(seconds, lastWord + 0.25)),
    matte: cards.some((c) => c.behind),
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
