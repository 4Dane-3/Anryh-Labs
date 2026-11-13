// The harsh buyer test's bookkeeping and the publish verdict. Pure, so the tests cover it.
import { BUYER_RUNS, BUYER_WINS, KEEP_DESCRIPTIONS, KEEP_HEADLINES, PUBLISH_CONFIDENCE } from "@/lib/competitors/gates";
import type { Drafts, Headline, Matchup } from "@/lib/competitors/types";

/** Competitor text with every brand name and domain taken out, so the buyer judges words, not names. */
export function stripBrands(text: string, names: string[]) {
  let t = text;
  for (const n of names.filter((x) => x && x.length >= 3).sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[company]");
  return t.replace(/\b[a-z0-9-]+\.(com|net|org|co|ie|us|biz)\b/gi, "[company]");
}

export type Question = { q: string; lineId: string; options: string[]; ours: number };

/** Each line against three of their lines, five times, shuffled. The key (which is ours) never goes to the buyer. */
export function buildQuestions(lines: Headline[], rivals: string[], runs = BUYER_RUNS, rand = Math.random): Question[] {
  const out: Question[] = [];
  if (rivals.length < 1) return out;
  let n = 0;
  for (const l of lines) {
    for (let r = 0; r < runs; r++) {
      const picks = [...rivals].sort(() => rand() - 0.5).slice(0, Math.min(3, rivals.length));
      const options = [...picks, l.text].sort(() => rand() - 0.5);
      out.push({ q: `q${++n}`, lineId: l.id, options, ours: options.indexOf(l.text) });
    }
  }
  return out.sort(() => rand() - 0.5);
}

/** Tallies wins per line; a line passes with 4 of 5. */
export function tally(pool: Headline[], questions: Question[], picks: Record<string, { pick: number; why: string }>) {
  const byLine = new Map<string, { wins: number; runs: number; lost: string[] }>();
  for (const q of questions) {
    const p = picks[q.q];
    if (!p) continue;
    const t = byLine.get(q.lineId) ?? { wins: 0, runs: 0, lost: [] };
    t.runs++;
    if (p.pick - 1 === q.ours) t.wins++;
    else if (p.why) t.lost.push(p.why);
    byLine.set(q.lineId, t);
  }
  const notes: string[] = [];
  for (const l of pool) {
    if (l.stage === "rules") continue;
    const t = byLine.get(l.id);
    if (!t) continue;
    l.wins = t.wins;
    l.runs = t.runs;
    if (t.wins >= Math.ceil((BUYER_WINS / BUYER_RUNS) * t.runs)) Object.assign(l, { stage: "spare", reason: null });
    else {
      Object.assign(l, { stage: "buyer", reason: `Picked in ${t.wins} of ${t.runs} runs${t.lost[0] ? `: "${t.lost[0].slice(0, 120)}"` : ""}` });
      if (t.lost[0]) notes.push(`"${l.text}" lost: ${t.lost[0].slice(0, 160)}`);
    }
  }
  return notes;
}

/** The verdict: publishable only with a full ad, the variety floor met, and 9/10 or better against every winner. */
export function verdict(kept: { headlines: string[]; descriptions: string[]; varietyOk: boolean }, games: Matchup[]): Drafts["verdict"] {
  const min = games.length ? Math.min(...games.map((g) => g.confidence)) : 0;
  if (kept.headlines.length < KEEP_HEADLINES) return { publishable: false, minConfidence: min, why: `Only ${kept.headlines.length} of 15 headlines passed all three filters. Run it again after adding proof (reviews, warranty, years) the competitors can't match.` };
  if (kept.descriptions.length < KEEP_DESCRIPTIONS) return { publishable: false, minConfidence: min, why: `Only ${kept.descriptions.length} of 4 descriptions passed.` };
  if (!kept.varietyOk) return { publishable: false, minConfidence: min, why: "The kept headlines cover fewer than 4 of the 6 angles." };
  if (!games.length) return { publishable: false, minConfidence: 0, why: "No competitor winners to test against." };
  if (min < PUBLISH_CONFIDENCE) {
    const worst = games.find((g) => g.confidence === min)!;
    return { publishable: false, minConfidence: min, why: `Only ${min}/10 sure ours beats ${worst.theirs.advertiser}'s ad: ${worst.why}` };
  }
  return { publishable: true, minConfidence: min, why: `At least ${min}/10 sure ours beats every winning competitor ad.` };
}

