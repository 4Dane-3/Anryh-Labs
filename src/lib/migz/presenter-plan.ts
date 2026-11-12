// The "owner on camera" video, the parts with no I/O: which b-roll clips to make, and when each caption, card,
// cut-away and sound effect lands. The owner talks (their own recording, or HeyGen's lip-synced AI version of
// their photo); a callout and town pins open it, big captions follow the words, real job clips cut in, a real
// offer and badge show if they gave them, and a Tap Learn More card closes it.

export type PresenterPlan = {
  mode: "ai" | "film";
  script: string;
  callout?: string | null; // the on-screen hook, 2-4 words ("Kenmore homeowners")
  towns: string[];
  offer?: string | null; // only what the roofer typed
  badge?: string | null; // only what the roofer typed
  photo_paths: string[]; // their own photos (creatives bucket)
  job_paths: string[]; // their own job photos (before kinds existed)
  broll_media?: { path: string; kind: string; type: "photo" | "video" }[]; // the cut-aways for this video, picked from their photos and clips
  film_path?: string | null; // their own recording
  voice_id?: string | null; // their cloned voice, when they gave a sample
  narrator?: "female" | "male";
  lead_offer?: string | null; // "free roof inspection" or "free quote" (end card), inspection when missing
  say_as?: { name: string; as: string } | null; // the voice says the name this way; captions keep the spelling
  look_id?: string | null; // their jobsite look (HeyGen): the video is made from it instead of the plain photo
};

export const BROLL_CLIPS = 3;
export const BROLL_SECONDS = 2.2;
const CARD_SECONDS = 3;
const CALLOUT_SECONDS = 2.5;
const CTA_SECONDS = 3.5;

const JOB_MOTION = "Slow, smooth drone-style push across this real roofing job. Nothing is added or changed, no people appear or vanish.";

/** The b-roll to make with Higgsfield: a short move across each of their real job photos, up to three. */
export function brollShots(jobPaths: string[]) {
  return jobPaths.slice(0, BROLL_CLIPS).map((path) => ({ path, prompt: JOB_MOTION }));
}

export type Word = { word: string; start: number; end: number };

/** Words with times from character times (ElevenLabs' alignment). */
export function wordsFromChars(chars: string[], starts: number[], ends: number[]): Word[] {
  const words: Word[] = [];
  let cur: Word | null = null;
  chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
    } else if (cur) {
      cur.word += c;
      cur.end = ends[i];
    } else cur = { word: c, start: starts[i], end: ends[i] };
  });
  if (cur) words.push(cur);
  return words;
}

export type Caption = { text: string; emphasis: string; start: number; end: number };

/** Words grouped into punchy 2-to-4 word captions, each up until the next starts; a pause or sentence end closes one. */
export function captions(words: Word[]): Caption[] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const sentence = /[.!?,]$/.test(w.word);
    const pause = next ? next.start - w.end > 0.3 : true;
    if (cur.length >= 4 || ((sentence || pause) && cur.length >= 2) || !next) {
      groups.push(cur);
      cur = [];
    }
  });
  return groups.map((g, i) => ({
    text: g.map((w) => w.word).join(" "),
    emphasis: g[g.length - 1].word,
    start: g[0].start,
    end: groups[i + 1] ? groups[i + 1][0].start : g[g.length - 1].end + 0.2,
  }));
}

export type Card = { kind: "callout" | "towns" | "offer" | "badge" | "cta"; start: number; end: number };

/** When the cards show: the callout first, then town pins, the offer and badge in the middle, Tap Learn More last. */
export function cardTimes(seconds: number, plan: Pick<PresenterPlan, "towns" | "offer" | "badge" | "callout">): Card[] {
  const cards: Card[] = [];
  let open = 0;
  if (plan.callout) {
    cards.push({ kind: "callout", start: 0, end: Math.min(CALLOUT_SECONDS, seconds) });
    open = CALLOUT_SECONDS;
  }
  if (plan.towns.length) cards.push({ kind: "towns", start: open, end: Math.min(open + 2.5, seconds) });
  // One card at a time: a short video drops the badge rather than stacking it on the offer or the last card
  const ctaStart = Math.max(0, seconds - CTA_SECONDS);
  let free = Math.max(seconds * 0.4, open + (plan.towns.length ? 3 : 0.5));
  for (const [kind, text] of [["offer", plan.offer], ["badge", plan.badge]] as const) {
    if (!text || free + CARD_SECONDS > ctaStart) continue;
    cards.push({ kind, start: free, end: free + CARD_SECONDS });
    free += CARD_SECONDS + 0.5;
  }
  cards.push({ kind: "cta", start: ctaStart, end: seconds });
  return cards;
}

/** When each job clip cuts in over the owner: spread through the middle, never in the hook or over the last card. */
export function brollTimes(seconds: number, count: number) {
  const from = Math.max(5, seconds * 0.25);
  const to = seconds - CTA_SECONDS - 0.5;
  const fit = Math.min(count, Math.max(0, Math.floor((to - from) / (BROLL_SECONDS + 1.5))));
  if (!fit) return [];
  const gap = (to - from - fit * BROLL_SECONDS) / fit;
  return Array.from({ length: fit }, (_, i) => {
    const start = from + gap / 2 + i * (BROLL_SECONDS + gap);
    return { start, end: start + BROLL_SECONDS };
  });
}

export type Sfx = { kind: "hit" | "whoosh" | "pop"; at: number };

/** The sound design: a hit on the first frame, a whoosh as each card or cut-away comes in, a pop on each caption. */
export function sfxEvents(cards: Card[], caps: Caption[], broll: { start: number }[]): Sfx[] {
  const loud: Sfx[] = [{ kind: "hit", at: 0 }, ...[...cards, ...broll].filter((c) => c.start > 0.2).map((c) => ({ kind: "whoosh" as const, at: c.start }))];
  // A pop right on top of a whoosh only muddies it
  const pops = caps.filter((c) => !loud.some((l) => Math.abs(l.at - c.start) < 0.3)).map((c) => ({ kind: "pop" as const, at: c.start }));
  return [...loud, ...pops].sort((a, b) => a.at - b.at);
}

/** ffmpeg filter chain laying each overlay (inputs firstInput.. on) over `from` during its time. */
export function overlayFilter(times: { start: number; end: number }[], from = "0:v", firstInput = 1) {
  const steps = times.map((t, i) => `[${i === 0 ? from : `v${i}`}][${firstInput + i}:v]overlay=0:0:enable='between(t,${t.start.toFixed(2)},${t.end.toFixed(2)})'[v${i + 1}]`);
  return { filter: steps.join(";"), out: times.length ? `[v${times.length}]` : `[${from}]` };
}

/** The script as the voice should read it: their name spelled the way it's said. Pure. */
export function sayNameAs(script: string, name: string | null | undefined, pronunciation: string | null | undefined) {
  const n = name?.trim();
  const say = pronunciation?.trim();
  if (!n || !say || say.toLowerCase() === n.toLowerCase()) return script;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return script.replace(new RegExp(`\\b${escaped}\\b`, "gi"), say);
}
