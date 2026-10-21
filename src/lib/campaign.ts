import { DateTime } from "luxon";
import { TOPICS, type TopicKey } from "@/lib/migz/topics";

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

// Each campaign Migz runs gets $10/day. Two is the minimum, so Migz always has a second campaign to
// compare against; two weeks gives 7 days of results to revise on and 7 more to see if the changes worked.
export const CAMPAIGN_DAILY_CENTS = 1000;
export const MIN_CAMPAIGNS = 2;
export const MAX_CAMPAIGNS = 6;
export const TEST_DAYS = 14;
export const REVISE_AFTER_DAYS = 7;

export const BUDGETS = [20, 30, 40, 60] as const; // dollars per day: 2, 3, 4 and 6 campaigns

export const MIN_DAILY_CENTS = MIN_CAMPAIGNS * CAMPAIGN_DAILY_CENTS;
export const MAX_DAILY_CENTS = 100_000;

// Anryh Labs keeps 20% of each deposit; the rest is ad spend. The minimum deposit funds the minimum plan:
// $350 -> $280 of ads = 2 campaigns x $10/day x 14 days.
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

/** How many campaigns a daily budget runs, at $10/day each (at least 1, at most MAX_CAMPAIGNS). */
export function campaignCount(dailyCents: number) {
  return Math.min(MAX_CAMPAIGNS, Math.max(1, Math.floor(dailyCents / CAMPAIGN_DAILY_CENTS)));
}

/**
 * Which focus topic each campaign serves. One campaign per focus, top focus first, while the budget
 * covers them; with more campaigns than focuses the extras follow the focus order (4 campaigns over
 * 3 focuses = 2 on the main focus, 1 on each of the others). With no focus, campaigns have no topic.
 */
export function allocateCampaigns(focus: readonly TopicKey[], count: number): (TopicKey | null)[] {
  if (!focus.length) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => focus[i % focus.length]);
}

/** Campaign names that read well in Meta and in the dashboard: "Final expense", or "Final expense B". */
export function campaignLabels(slots: readonly (TopicKey | null)[]) {
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const t of slots) totals.set(t ?? "", (totals.get(t ?? "") ?? 0) + 1);
  return slots.map((t) => {
    const base = t ? TOPICS[t].label : "Booked calls";
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
