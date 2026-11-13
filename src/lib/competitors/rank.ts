// Ranks competitor ads, best to worst, separately per market and platform, and keeps the best 15%. Pure.
//
// No ad library shows spend or results for local businesses, so each list is ranked on its best clue:
//   your area, Google:   days running (Google has no hidden impressions order in the US)
//   your area, Meta:     Meta's impressions order (the Ad Library's "sort by impressions" is its delivery rank)
//   benchmark, Google:   impressions a day (Europe makes Google show impression ranges)
//   benchmark, Meta:     reach a day (Europe makes Meta show real reach)
// Out before ranking: ads under 14 days old, ads with no landing page we could find, hiring posts, Local Services and
// Maps ads, and copies of the same ad (counted once, the copies add to its count).

import type { CompAd, Market, Platform } from "@/lib/competitors/types";

export const MIN_DAYS = 14;
export const TOP_SHARE = 0.15;
export const MIN_TOP = 3;

export type Category = { market: string; platform: Platform; clue: string };

export function clueFor(kind: Market["kind"], platform: Platform) {
  if (kind === "local") return platform === "google" ? "days running" : "Meta's impressions order";
  return platform === "google" ? "impressions a day" : "reach a day";
}

const words = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();
export const fingerprint = (a: Pick<CompAd, "headline" | "body" | "description">) => words(`${a.headline ?? ""} ${a.body ?? ""} ${a.description ?? ""}`).split(" ").slice(0, 40).join(" ");
const allText = (a: CompAd) => `${a.headline ?? ""} ${a.body ?? ""} ${a.description ?? ""}`;

/** Why an ad is left out of the ranking, or null. */
export function exclusion(a: CompAd): string | null {
  const t = allText(a);
  if (/google guaranteed|local services|google screened/i.test(t)) return "A Local Services or Maps ad";
  if (/\b(now hiring|we'?re hiring|join our team|careers?|apply today|job openings?)\b/i.test(t)) return "A hiring post";
  if (!t.trim()) return "No readable text";
  if (a.daysRunning == null || a.daysRunning < MIN_DAYS) return `Ran ${a.daysRunning ?? 0} days (under ${MIN_DAYS})`;
  if (!a.landingUrl) return "No landing page found";
  return null;
}

/** The number each list is ranked on (higher is better), and how it reads. Null: no clue, ranks last. */
function clueValue(a: CompAd, kind: Market["kind"]): { value: number | null; label: string } {
  if (a.platform === "google") {
    if (kind === "benchmark" && a.impressionsPerDay != null) return { value: a.impressionsPerDay, label: `${a.impressionsPerDay.toLocaleString("en-US")} impressions a day` };
    return { value: a.daysRunning, label: `${a.daysRunning ?? 0} days running` };
  }
  if (kind === "benchmark" && a.reachPerDay != null) return { value: a.reachPerDay, label: `${a.reachPerDay.toLocaleString("en-US")} people reached a day` };
  // Impressions order: 1st is best. More copies (more ad sets) is a small boost.
  if (a.impressionsRank != null) {
    const copies = Math.max(1, a.copies ?? 1);
    return { value: 1000 / a.impressionsRank + Math.log2(copies) * 10, label: `#${a.impressionsRank} in Meta's impressions order${copies > 1 ? `, ${copies} copies` : ""}` };
  }
  return { value: null, label: "no delivery clue" };
}

/** Ranks every ad in place and returns them (excluded ones keep their reason; copies point at the first). */
export function rankAds(ads: CompAd[], markets: Market[]): CompAd[] {
  const kindOf = new Map(markets.map((m) => [m.key, m.kind]));
  for (const a of ads) Object.assign(a, { score: null, top: false, rank: null, clue: null, excluded: null, duplicateOf: null });
  // Copies of the same ad, per market and platform: the one with the strongest clue stays
  const groups = new Map<string, CompAd[]>();
  for (const a of ads) {
    const fp = fingerprint(a);
    if (!fp) continue;
    const k = `${a.market}|${a.platform}|${a.domain ?? a.advertiser}|${fp}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const kind = kindOf.get(list[0].market) ?? "local";
    list.sort((x, y) => (clueValue(y, kind).value ?? -1) - (clueValue(x, kind).value ?? -1));
    const keep = list[0];
    keep.copies = Math.max(keep.copies ?? 1, 1) + list.length - 1;
    for (const c of list.slice(1)) {
      c.duplicateOf = keep.id;
      c.excluded = "A copy of another ad (counted once)";
    }
  }
  for (const a of ads) if (!a.excluded) a.excluded = exclusion(a);

  for (const m of markets) {
    for (const platform of ["google", "meta"] as Platform[]) {
      const pool = ads.filter((a) => a.market === m.key && a.platform === platform && !a.excluded);
      const scored = pool.map((a) => ({ a, ...clueValue(a, m.kind) }));
      scored.sort((x, y) => (y.value ?? -1) - (x.value ?? -1) || (y.a.daysRunning ?? 0) - (x.a.daysRunning ?? 0));
      const n = scored.length;
      const topN = n ? Math.min(n, Math.max(MIN_TOP, Math.ceil(n * TOP_SHARE))) : 0;
      scored.forEach((s, i) => {
        s.a.rank = i + 1;
        s.a.score = n > 1 ? Math.round(100 * (1 - i / (n - 1))) : 100;
        s.a.clue = s.label;
        s.a.top = i < topN && s.value != null;
      });
    }
  }
  return ads;
}

/** The categories in display order, with what each is ranked on. */
export const categoriesOf = (markets: Market[]): Category[] => markets.flatMap((m) => (["google", "meta"] as Platform[]).map((platform) => ({ market: m.key, platform, clue: clueFor(m.kind, platform) })));

// ---------- Offers ----------

/** "Free quote", "free inspection", "call now", a phone number: what every roofer says. Not an offer. */
export const NOT_AN_OFFER = /^(free (roof )?(quotes?|estimates?|inspections?|consultations?)|call( us)?( now| today)?|get a quote|contact us|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})$/i;
