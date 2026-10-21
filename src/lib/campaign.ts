import { DateTime } from "luxon";

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

export const BUDGETS = [20, 30, 50, 100] as const; // dollars per day

export const MIN_DAILY_CENTS = 500;
export const MAX_DAILY_CENTS = 100_000;

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
