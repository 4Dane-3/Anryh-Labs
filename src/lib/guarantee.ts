// The booked-call guarantee: the first 30 days after an agent's campaign launches. If they keep it funded and
// running, send ads to their Anryh Labs booking page and keep their calendar open, they get at least the target
// number of booked calls, or the Anryh Labs fee on the funds they added is credited back (staff approve it).
// What the agent does on the calls is theirs: only bookings count. Pure (client-safe), so the dashboard card,
// the daily check and the tests share one set of rules.

export const GUARANTEE_DAYS = 30;
/** Days without ad spend the month may have (a slow start, a day Meta held delivery) and still count as running. */
export const MAX_DAYS_OFF = 3;
export const MIN_OPEN_HOURS_PER_WEEK = 15;
export const MIN_GUARANTEE_DAILY_CENTS = 5000;
/** $75/day or more raises the target. */
export const HIGH_DAILY_CENTS = 7500;
export const TARGET_LOW = 8;
export const TARGET_HIGH = 12;

export const targetFor = (dailyCents: number) => (dailyCents >= HIGH_DAILY_CENTS ? TARGET_HIGH : TARGET_LOW);

/** A month of ad funds at the launch budget (never under $50/day): what the agent must have added for ads. */
export const monthOfFundsCents = (dailyCents: number) => Math.max(dailyCents, MIN_GUARANTEE_DAILY_CENTS) * GUARANTEE_DAYS;

/** ISO date `days` after `iso` (UTC date arithmetic, no time zones). */
export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Weekly bookable hours from the agent's working-hours rules ("HH:MM[:SS]"). */
export function openHoursPerWeek(rules: { start_time: string; end_time: string }[]) {
  const min = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  return rules.reduce((sum, r) => sum + Math.max(0, min(r.end_time) - min(r.start_time)), 0) / 60;
}

export type GuaranteeInput = {
  startsOn: string;
  endsOn: string;
  today: string;
  dailyCents: number;
  target: number;
  bookings: number;
  /** Ad money added (deposits after the fee), up to today or the end. */
  adFundsAddedCents: number;
  /** Days in the window so far with ad spend. */
  spendDays: number;
  ownBookingPage: boolean;
  openHours: number;
  migzOff: boolean;
};

export type Condition = { key: "funded" | "running" | "booking_page" | "calendar" | "migz"; label: string; ok: boolean; detail: string };

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Where a guarantee stands: the day, the bookings against the target, each condition, and (once the 30 days are
 * over) the verdict. While it's running, "funded" is only a warning: funds can still be added before the end.
 */
export function evaluateGuarantee(g: GuaranteeInput) {
  const daysTotal = GUARANTEE_DAYS;
  const elapsed = Math.min(daysTotal, Math.max(0, Math.round((Date.parse(`${g.today}T00:00:00Z`) - Date.parse(`${g.startsOn}T00:00:00Z`)) / 86_400_000) + 1));
  const done = g.today > g.endsOn;
  const daysSoFar = done ? daysTotal : Math.max(0, elapsed - 1); // today isn't over yet
  const daysOff = Math.max(0, daysSoFar - g.spendDays);
  const month = monthOfFundsCents(g.dailyCents);
  const conditions: Condition[] = [
    {
      key: "funded",
      label: "A month of ad funds",
      ok: g.adFundsAddedCents >= month,
      detail: `${usd(g.adFundsAddedCents)} of ${usd(month)} added for ads`,
    },
    {
      key: "running",
      label: "Ads kept running",
      ok: daysOff <= MAX_DAYS_OFF,
      detail: daysOff ? `${daysOff} day${daysOff === 1 ? "" : "s"} without ads (up to ${MAX_DAYS_OFF} allowed)` : "Running every day so far",
    },
    {
      key: "booking_page",
      label: "Ads go to your Anryh Labs booking page",
      ok: !g.ownBookingPage,
      detail: g.ownBookingPage ? "Your ads go to your own booking page, where bookings can't be counted" : "Bookings are counted on your page",
    },
    {
      key: "calendar",
      label: `At least ${MIN_OPEN_HOURS_PER_WEEK} hours a week open for calls`,
      ok: g.openHours >= MIN_OPEN_HOURS_PER_WEEK,
      detail: `${Math.round(g.openHours * 10) / 10} hours a week open`,
    },
    { key: "migz", label: "Migz switched on", ok: !g.migzOff, detail: g.migzOff ? "Migz is off" : "On" },
  ];
  const unmet = conditions.filter((c) => !c.ok);
  // Funding can still happen before the end, so it only decides the verdict once the month is over
  const blocking = done ? unmet : unmet.filter((c) => c.key !== "funded");
  const met = g.bookings >= g.target;
  const status: "running" | "met" | "missed" | "ineligible" = !done ? "running" : met ? "met" : unmet.length ? "ineligible" : "missed";
  return { day: elapsed, daysTotal, done, conditions, unmet: unmet.map((c) => c.key), onTrack: !blocking.length, met, status };
}
