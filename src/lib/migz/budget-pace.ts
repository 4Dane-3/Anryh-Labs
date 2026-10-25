import { DateTime } from "luxon";

// The monthly AI budget, paced across the month: each day gets an allowance of what's left divided by
// the days left (today included), so a busy day can't use up the whole month, and a quiet day's unused
// share carries forward to the days after it. Pure, so tests can walk through a month.

export type Budget = {
  limitUsd: number; // the month's budget
  spentUsd: number; // spent this month
  todayUsd: number; // spent today (the agent's own day)
  dailyUsd: number; // today's allowance
  monthRatio: number; // spentUsd / limitUsd
  dayRatio: number; // todayUsd / dailyUsd
  ratio: number; // the tighter of the two: what planTier acts on
};

const share = (spent: number, of: number) => (of > 0 ? spent / of : spent > 0 ? Infinity : 0);

/** The calendar month and day in the agent's timezone. */
export function budgetWindow(timezone: string, now: Date = new Date()) {
  const local = DateTime.fromJSDate(now).setZone(timezone);
  return {
    monthStart: local.startOf("month").toUTC().toISO()!,
    dayStart: local.startOf("day").toUTC().toISO()!,
    daysLeft: local.daysInMonth! - local.day + 1, // today included
  };
}

export function pacedBudget(input: { limitUsd: number; monthSpentUsd: number; todaySpentUsd: number; daysLeft: number }): Budget {
  const { limitUsd, monthSpentUsd: spentUsd, todaySpentUsd: todayUsd } = input;
  if (!Number.isFinite(limitUsd)) return { limitUsd, spentUsd, todayUsd, dailyUsd: Infinity, monthRatio: 0, dayRatio: 0, ratio: 0 };
  const before = Math.max(0, spentUsd - todayUsd); // spent before today
  const dailyUsd = Math.max(0, limitUsd - before) / Math.max(1, input.daysLeft);
  const monthRatio = share(spentUsd, limitUsd);
  const dayRatio = share(todayUsd, dailyUsd);
  return { limitUsd, spentUsd, todayUsd, dailyUsd, monthRatio, dayRatio, ratio: Math.max(monthRatio, dayRatio) };
}
