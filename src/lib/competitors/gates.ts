// The filters every new headline and description passes. Pure, so the tests cover it.
//   Filter 1, the rules: length, banned words, roofing claims we never make, every claim and number provable from
//     the roofer's proof, no competitor names, no phone numbers, symbols, all caps or "!" in a headline.
//   Filter 2, the harsh buyer, runs with the model (writer.ts): ours has to be picked over theirs in 4 of 5 blind runs.
//   Filter 3, variety: near-copies of a line already kept die, and the kept set covers at least 4 of the 6 angles with
//     no angle over a third of it.

import { roofingCopyProblem } from "@/lib/verticals";
import type { AdContext, Angle, Headline } from "@/lib/competitors/types";

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;
export const KEEP_HEADLINES = 15;
export const KEEP_DESCRIPTIONS = 4;
export const BUYER_RUNS = 5;
export const BUYER_WINS = 4;
export const NEAR_COPY = 0.88;
export const ANGLES: Exclude<Angle, "keyword">[] = ["offer", "speed", "price", "trust", "risk-reversal", "ask"];
export const PUBLISH_CONFIDENCE = 9; // out of 10: nothing goes out we're not 9/10 sure beats theirs

export const BANNED = ["#1", "number one", "best", "top-rated", "top rated", "cheapest", "lowest price", "fastest", "unbeatable", "amazing", "shocking", "miracle", "revolutionary", "world-class", "game-changer", "game changer", "secret", "hack", "click here", "risk-free", "100% guaranteed", "act now", "don't miss", "limited time"];
/** Words that claim something: each needs the same claim in the roofer's proof. */
export const CLAIM_WORDS: [RegExp, RegExp][] = [
  [/\bguarantee(d|s)?\b/i, /guarantee/i],
  [/\bwarrant(y|ies)\b/i, /warrant/i],
  [/\bcertified\b/i, /certif|master elite|preferred|select shingle|platinum|elite/i],
  [/\blicensed\b/i, /licen[sc]e/i],
  [/\binsured\b/i, /insur/i],
  [/\baward/i, /award/i],
  [/\brated\b/i, /rat(ed|ing)|stars?/i],
  [/\breviews?\b/i, /review/i],
  [/\bstars?\b/i, /stars?|rating/i],
  [/\baccredited\b/i, /accredit|bbb/i],
  [/\brefund|money-back|money back\b/i, /refund|money.back/i],
  [/\bproven\b/i, /proven/i],
  [/\btrusted\b/i, /trusted/i],
  [/\bexperts?\b/i, /expert/i],
  [/\bfamily[- ]owned\b/i, /family/i],
  [/\blocal(ly owned)?\b/i, /local|based in|owned/i],
];
const ALLOWED_CAPS = new Set(["GAF", "BBB", "HOA", "USA", "US", "DIY", "ASAP", "OK", "LLC", "HVAC", "TPO", "EPDM", "FAQ", "AM", "PM"]);

/** The roofer's provable claims as one searchable text (only the "can claim" lines; hold and never don't count). */
export function proofText(ctx: Pick<AdContext, "proof" | "reviews">) {
  const lines = [...ctx.proof.offer, ...ctx.proof.promises, ...ctx.proof.numbers].map((p) => `${p.claim} ${p.adForm}`);
  if (ctx.reviews.rating && (ctx.reviews.count ?? 0) >= 10) lines.push(`${ctx.reviews.rating} stars rating ${ctx.reviews.count} Google reviews`);
  return lines.join(" \n ").toLowerCase();
}

/** Numbers with their unit ("$500", "25 years", "4.9", "10%"), to look up in the proof. */
export function numbersIn(s: string): string[] {
  return [...s.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?k?|\d[\d,]*(?:\.\d+)?\s?(?:%|\+|k\b|years?|yrs?|days?|hours?|hrs?|minutes?|mins?|stars?|reviews?|roofs?|homes?|jobs?)?/gi)]
    .map((m) => m[0].toLowerCase().replace(/\s+/g, " ").replace(/,/g, "").trim())
    .filter((n) => /\d/.test(n));
}

const unitless = (n: string) => n.replace(/[^0-9.]/g, "");

/** How alike two lines are, 0..1 (Dice on letter pairs, ignoring case and punctuation). */
export function similarity(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$ ]+/g, "").replace(/\s+/g, " ").trim();
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const A = grams(x);
  const B = grams(y);
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}

/** Filter 1 for one line: the reason it fails, or null. */
export function checkLine(text: string, kind: "headline" | "description", input: { proof: string; competitors: string[] }): string | null {
  const t = text.trim();
  const max = kind === "headline" ? HEADLINE_MAX : DESCRIPTION_MAX;
  if (!t) return "Empty";
  if (t.length > max) return `${t.length} characters (${max} max)`;
  const lower = t.toLowerCase();
  const banned = BANNED.find((b) => new RegExp(`(^|[^a-z])${b.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}([^a-z]|$)`, "i").test(lower));
  if (banned) return `Banned word: "${banned}"`;
  const roof = roofingCopyProblem(t);
  if (roof) return roof;
  if (kind === "headline" && t.includes("!")) return 'No "!" in a headline';
  if ((t.match(/!/g) ?? []).length > 1) return 'At most one "!"';
  if (/[!?.]{2,}/.test(t)) return "Repeated punctuation";
  if (/—|–/.test(t)) return "No dashes like that";
  if (/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(t)) return "No phone numbers (they go in the call button)";
  if (/[^\x20-\x7E’]/.test(t)) return "No emoji or symbols";
  if (/\b(?:[A-Z]\s){3,}/.test(t)) return "No gimmick spacing";
  const caps = t.match(/\b[A-Z]{3,}\b/g)?.find((w) => !ALLOWED_CAPS.has(w));
  if (caps) return `No words in all caps ("${caps}")`;
  const rival = input.competitors.find((c) => c.length >= 4 && lower.includes(c.toLowerCase()));
  if (rival) return `Names a competitor ("${rival}")`;
  for (const n of numbersIn(t)) {
    const bare = unitless(n);
    if (!bare) continue;
    if (!input.proof.includes(n) && !(new RegExp(`(^|[^0-9.])${bare.replace(".", "\\.")}([^0-9]|$)`).test(input.proof) && /^[\d.]+$/.test(n))) return `"${n}" isn't in the proof`;
  }
  for (const [word, need] of CLAIM_WORDS) if (word.test(t) && !need.test(input.proof)) return `Claims "${t.match(word)?.[0]}" with nothing on file to back it`;
  return null;
}

/** Runs filter 1 over a pool, then marks near-copies of an earlier line (filter 3's first half). Mutates and returns. */
export function applyRules(pool: Headline[], kind: "headline" | "description", input: { proof: string; competitors: string[] }) {
  for (const h of pool) {
    const why = checkLine(h.text, kind, input);
    if (why) Object.assign(h, { stage: "rules", reason: why });
  }
  return pool;
}

/**
 * Filter 3 and the pick: of the lines that passed the rules and the buyer, the strongest (most buyer wins) that aren't
 * near-copies of one already picked, spread over the angles (no angle over a third). Up to `keep` lines; the rest
 * that passed are "spare", the near-copies "repeat".
 */
export function pickBest(pool: Headline[], keep: number) {
  const passed = pool.filter((h) => h.stage === "kept" || h.stage === "spare").sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));
  const picked: Headline[] = [];
  const perAngle = new Map<string, number>();
  const cap = Math.max(1, Math.floor(keep / 3));
  for (const h of passed) {
    const copy = picked.find((p) => similarity(p.text, h.text) >= NEAR_COPY);
    if (copy) {
      Object.assign(h, { stage: "repeat", reason: `Too close to "${copy.text}"` });
      continue;
    }
    const n = perAngle.get(h.angle) ?? 0;
    if (picked.length >= keep || (h.angle !== "keyword" && n >= cap)) {
      Object.assign(h, { stage: picked.length >= keep ? "spare" : "repeat", reason: picked.length >= keep ? "Passed, but the 15 strongest were already picked" : `Already ${n} "${h.angle}" lines: variety` });
      continue;
    }
    picked.push(h);
    perAngle.set(h.angle, n + 1);
    Object.assign(h, { stage: "kept", reason: null });
  }
  const angles = new Set(picked.map((p) => p.angle).filter((a) => a !== "keyword"));
  return { picked, anglesCovered: angles.size, varietyOk: angles.size >= 4 };
}
