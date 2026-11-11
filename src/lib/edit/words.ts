// Transcript helpers for the edit: the tight cut, exact spelling of names, and reading spoken numbers. No I/O.

export type Word = { word: string; start: number; end: number };
export type Segment = { from: number; to: number }; // a kept stretch of the source, in source seconds

export const MAX_PAUSE = 0.15; // a longer gap between words is cut
const FILLERS = /^(um+|uh+|erm+|hmm+|ah+|uh-huh|mm+)[.,!?]*$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%+]/g, "");

/** Drops fillers and false starts: a sentence repeated (or restarted) soon after keeps only its last complete take. */
export function cleanTakes(words: Word[]): Word[] {
  const kept = words.filter((w) => !FILLERS.test(w.word.trim()));
  // Sentences by punctuation or a long pause
  const sentences: Word[][] = [];
  let cur: Word[] = [];
  kept.forEach((w, i) => {
    cur.push(w);
    const next = kept[i + 1];
    if (/[.!?]$/.test(w.word) || !next || next.start - w.end > 0.8) {
      sentences.push(cur);
      cur = [];
    }
  });
  const tokens = sentences.map((s) => s.map((w) => norm(w.word)).filter(Boolean));
  const drop = new Set<number>();
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 2, sentences.length - 1); j++) {
      const a = tokens[i];
      const b = tokens[j];
      if (!a.length || !b.length) continue;
      // A restart: the earlier one is the start of the later one, or they share most words in order
      const prefix = a.every((t, k) => b[k] === t);
      const shared = a.filter((t) => b.includes(t)).length / Math.max(a.length, 1);
      if ((prefix && a.length >= 2) || (shared >= 0.8 && a.length >= 3 && Math.abs(a.length - b.length) <= 3)) {
        drop.add(i);
        break;
      }
    }
  }
  return dropRestarts(sentences.filter((_, i) => !drop.has(i)).flat());
}

/** A restart inside a sentence ("I own Summit I own Summit Peak Roofing"): the first try of the repeated words goes. */
function dropRestarts(words: Word[]): Word[] {
  const out = [...words];
  for (let i = 0; i < out.length; i++) {
    for (let k = 5; k >= 2; k--) {
      const a = out.slice(i, i + k).map((w) => norm(w.word));
      const b = out.slice(i + k, i + 2 * k).map((w) => norm(w.word));
      if (b.length === k && a.every((t, j) => t && t === b[j])) {
        out.splice(i, k);
        i = Math.max(-1, i - 1);
        break;
      }
    }
  }
  return out;
}

/** The kept stretches: words closer than MAX_PAUSE stay together, with 2 frames of handle, never cutting a word. */
export function tightCut(words: Word[], fps: number, sourceSeconds: number): Segment[] {
  if (!words.length) return [];
  const handle = 2 / fps;
  const segs: Segment[] = [];
  let from = words[0].start;
  let to = words[0].end;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    // A gap over the limit, or a jump back (a dropped take put the words out of order)
    if (w.start - to > MAX_PAUSE || w.start < to - 0.01) {
      segs.push({ from, to });
      from = w.start;
    }
    to = Math.max(to, w.end);
  }
  segs.push({ from, to });
  // Handles, without overlapping a neighbour or leaving the source
  return segs
    .map((s, i) => ({
      from: Math.max(0, i ? Math.max(s.from - handle, (segs[i - 1].to + s.from) / 2) : s.from - handle),
      to: Math.min(sourceSeconds, i < segs.length - 1 ? Math.min(s.to + handle, (s.to + segs[i + 1].from) / 2) : s.to + handle),
    }))
    .filter((s) => s.to - s.from >= 1 / fps);
}

/** Source time -> edited time for a moment inside a kept segment. */
export function toEdited(segments: Segment[], t: number): number {
  let offset = 0;
  for (const s of segments) {
    if (t <= s.to) return offset + Math.max(0, t - s.from);
    offset += s.to - s.from;
  }
  return offset;
}

export const editedLength = (segments: Segment[]) => segments.reduce((n, s) => n + (s.to - s.from), 0);

/** The words on the edited timeline. */
export function retime(words: Word[], segments: Segment[]): Word[] {
  return words.map((w) => ({ word: w.word, start: toEdited(segments, w.start), end: toEdited(segments, w.end) }));
}

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const similar = (a: string, b: string) => a.length >= 3 && 1 - distance(a, b) / Math.max(a.length, b.length) >= 0.8;
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Names, brands and towns spelled exactly as the roofer typed them, however the transcript heard them
 * ("Certainteed Shingle Master" -> "CertainTeed ShingleMaster"). Punctuation after the last word is kept.
 */
export function fixNames(words: Word[], names: string[]): Word[] {
  let out = [...words];
  // Longest names first, so "Summit Peak Roofing" wins over "Summit"
  for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    const parts = name.split(/\s+/);
    const target = letters(name);
    if (target.length < 3) continue;
    const next: Word[] = [];
    for (let i = 0; i < out.length; ) {
      let matched = 0;
      // The same number of words first, then one fewer or more; the first word heard must start like the name
      // (so "own Summit Peak Roofing" never swallows "own")
      const first = letters(parts[0]);
      for (const len of [parts.length, parts.length - 1, parts.length + 1]) {
        if (len < 1 || i + len > out.length) continue;
        const heard = out.slice(i, i + len);
        const h0 = letters(heard[0].word);
        if (h0.slice(0, 2) !== first.slice(0, 2) && !similar(h0, first)) continue;
        if (similar(letters(heard.map((w) => w.word).join("")), target)) {
          matched = len;
          break;
        }
      }
      if (!matched) {
        next.push(out[i]);
        i++;
        continue;
      }
      const heard = out.slice(i, i + matched);
      const tail = heard[heard.length - 1].word.match(/[.,!?;:]+$/)?.[0] ?? "";
      // Spread the exact parts over the heard time
      const t0 = heard[0].start;
      const t1 = heard[heard.length - 1].end;
      parts.forEach((p, k) => next.push({ word: p + (k === parts.length - 1 ? tail : ""), start: t0 + ((t1 - t0) * k) / parts.length, end: t0 + ((t1 - t0) * (k + 1)) / parts.length }));
      i += matched;
    }
    out = next;
  }
  return out;
}

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export type Spoken = { value: number; unit: "dollars" | "years" | "percent" | null; plus: boolean; first: number; last: number };

/** A number said at word i ("five hundred dollars", "$500", "25-year", "15+ years"), with its unit, or null. */
export function spokenNumber(words: Word[], i: number): Spoken | null {
  const raw = (k: number) => (words[k]?.word ?? "").toLowerCase().replace(/[.,!?;:]+$/, "");
  let k = i;
  let value: number | null = null;
  let dollars = false;
  let plus = false;
  const digits = raw(k).match(/^(\$)?(\d[\d,]*)(\+)?(%)?(?:-(year|yr)s?)?$/);
  if (digits) {
    value = Number(digits[2].replace(/,/g, ""));
    dollars = !!digits[1];
    plus = !!digits[3];
    if (digits[4]) return { value, unit: "percent", plus, first: i, last: i };
    if (digits[5]) return { value, unit: "years", plus, first: i, last: i };
    k++;
  } else {
    let total = 0;
    let current = 0;
    let any = false;
    for (; k < words.length; k++) {
      const parts = raw(k).split("-");
      let used = true;
      for (const p of parts) {
        if (p in UNITS) current += UNITS[p];
        else if (p in TENS) current += TENS[p];
        else if (p === "hundred" && any) current *= 100;
        else if (p === "thousand" && any) {
          total += current * 1000;
          current = 0;
        } else if (p === "year" || p === "years") {
          // "twenty-five-year"
          if (any) return { value: total + current, unit: "years", plus: false, first: i, last: k };
          used = false;
        } else used = false;
        if (used) any = true;
      }
      if (!used) break;
    }
    if (!any) return null;
    value = total + current;
  }
  // The unit after it
  const u = raw(k);
  if (u === "dollars" || u === "bucks") return { value, unit: "dollars", plus, first: i, last: k };
  if (u === "percent" || u === "%") return { value, unit: "percent", plus, first: i, last: k };
  if (u === "plus" || u === "+") {
    const after = raw(k + 1);
    if (after === "years") return { value, unit: "years", plus: true, first: i, last: k + 1 };
    return { value, unit: dollars ? "dollars" : null, plus: true, first: i, last: k };
  }
  if (u === "years" || u === "year" || u === "yrs") return { value, unit: "years", plus, first: i, last: k };
  return { value, unit: dollars ? "dollars" : null, plus, first: i, last: k - 1 };
}
