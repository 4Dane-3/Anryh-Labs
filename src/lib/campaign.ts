import { DateTime } from "luxon";
import { TOPICS, type TopicKey } from "@/lib/migz/topics";
import { MIN_IMPRESSIONS_TO_RANK } from "@/lib/migz/playbook";

// The campaign plan agents set on the Start here page: how long it runs and what it will roughly cost.
// Pure helpers (no I/O) so the dashboard, the launch action and Migz all agree.

export const DEFAULT_TITLE = "Licensed life insurance agent";

export const DURATIONS = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "Ongoing" }, // 0 = no end date
] as const;

// Migz runs one campaign with one ad set, and the agent's topics are compared ad by ad inside it. $20/day
// is the least that gives Meta enough to learn from; two weeks gives 7 days of results to revise on and
// 7 more to see if the changes worked.
export const MIN_DAILY_CENTS = 2000;
export const TEST_DAYS = 14;
export const REVISE_AFTER_DAYS = 7;

export const BUDGETS = [20, 30, 40, 60] as const; // dollars per day
export const MAX_DAILY_CENTS = 100_000;

// Anryh Labs keeps 20% of each deposit; the rest is ad spend. The minimum deposit funds the minimum plan:
// $350 -> $280 of ads = $20/day x 14 days.
export const FEE_RATE = 0.2;
export const MIN_DEPOSIT_CENTS = 35_000;
export const MAX_DEPOSIT_CENTS = 1_000_000;

/** What a deposit adds to the ad balance after the fee. */
export function adSpendCents(depositCents: number) {
  return Math.round(depositCents * (1 - FEE_RATE));
}

/** The deposit needed for a given amount of ad spend. */
export function depositFor(adCents: number) {
  return Math.ceil(adCents / (1 - FEE_RATE) / 100) * 100;
}

/** The least an ad balance needs to start: what the minimum deposit leaves after the fee. */
export const MIN_AD_BALANCE_CENTS = adSpendCents(MIN_DEPOSIT_CENTS);

/** The topic the agent's one campaign serves: their only focus, or null (ads on every focus topic). */
export const planTopic = (focus: readonly TopicKey[]): TopicKey | null => (focus.length === 1 ? focus[0] : null);

/**
 * Campaign names that read well in Meta and in the dashboard: "Final expense", "Final expense + Whole life"
 * for one campaign over several topics, or "Final expense B" when an older batch ran two on one topic.
 */
export function campaignLabels(slots: readonly (TopicKey | "explore" | null)[], focus: readonly TopicKey[] = []) {
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const t of slots) totals.set(t ?? "", (totals.get(t ?? "") ?? 0) + 1);
  return slots.map((t) => {
    const base = t === "explore" ? "Exploration" : t ? TOPICS[t].label : focus.length ? focus.map((f) => TOPICS[f].label).join(" + ") : "Booked calls";
    const n = (seen.get(t ?? "") ?? 0) + 1;
    seen.set(t ?? "", n);
    return (totals.get(t ?? "") ?? 0) > 1 ? `${base} ${String.fromCharCode(64 + n)}` : base;
  });
}

/** The daily budget split evenly across campaigns, in whole cents. */
export function perCampaignCents(dailyCents: number, count: number) {
  return Math.floor(dailyCents / Math.max(1, count));
}

/** Last day ads run: the start day counts as day 1. Null or 0 days = ongoing (no end date). */
export function endDate(startISO: string, days: number | null | undefined) {
  if (!days) return null;
  return DateTime.fromISO(startISO).plus({ days: days - 1 }).toISODate();
}

/** True once the campaign's last day is over (compared in the agent's own timezone). */
export function campaignEnded(endsOn: string | null | undefined, timezone: string, now = DateTime.now()) {
  if (!endsOn) return false;
  return now.setZone(timezone).toISODate()! > endsOn;
}

export function daysLeft(endsOn: string | null | undefined, timezone: string, now = DateTime.now()) {
  if (!endsOn) return null;
  const today = now.setZone(timezone).startOf("day");
  return Math.max(0, Math.round(DateTime.fromISO(endsOn, { zone: timezone }).startOf("day").diff(today, "days").days) + 1);
}

/** What the plan adds up to and whether the balance covers it. */
export function estimate(dailyCents: number, days: number | null | undefined, balanceCents: number) {
  const coveredDays = dailyCents > 0 ? Math.floor(balanceCents / dailyCents) : 0;
  const total = days ? dailyCents * days : null;
  return {
    totalCents: total,
    coveredDays,
    fullyFunded: total !== null ? balanceCents >= total : false,
    shortfallCents: total !== null ? Math.max(0, total - balanceCents) : null,
  };
}

export type AdResults = { impressions: number; clicks: number; booked: number };

/**
 * Best ad first, by results rather than spend (with no conversions Meta's spend is a guess): booked calls,
 * then link click-through for ads with a real read (MIN_IMPRESSIONS_TO_RANK), then the ads too new to
 * judge, most impressions first.
 */
export function byResults(stats: Map<string, AdResults>) {
  const get = (id: string) => stats.get(id) ?? { impressions: 0, clicks: 0, booked: 0 };
  const read = (r: AdResults) => r.impressions >= MIN_IMPRESSIONS_TO_RANK;
  return (a: { meta_ad_id: string }, b: { meta_ad_id: string }) => {
    const x = get(a.meta_ad_id);
    const y = get(b.meta_ad_id);
    if (x.booked !== y.booked) return y.booked - x.booked;
    if (read(x) !== read(y)) return read(x) ? -1 : 1;
    if (read(x)) return y.clicks / y.impressions - x.clicks / x.impressions;
    return y.impressions - x.impressions;
  };
}

/**
 * Which live ads a one-campaign batch carries over from the campaigns it retires: best results first
 * (byResults), only ads on the campaign's topic when it has one, one ad per creative (including ones
 * the campaign already runs), and no more than `room`.
 */
export function pickCarryOver<T extends { meta_ad_id: string; creative_id: string | null; topic: string | null }>(
  candidates: T[],
  opts: { room: number; topic: TopicKey | null; results: Map<string, AdResults>; running: Set<string> },
): T[] {
  const have = new Set(opts.running);
  const picks: T[] = [];
  const best = [...candidates].sort(byResults(opts.results));
  for (const a of best) {
    if (picks.length >= opts.room) break;
    if (opts.topic && a.topic !== opts.topic) continue;
    if (a.creative_id && have.has(a.creative_id)) continue;
    if (a.creative_id) have.add(a.creative_id);
    picks.push(a);
  }
  return picks;
}
