import { depositFor, MAX_DEPOSIT_CENTS, MIN_TOP_UP_CENTS, type FeePlan } from "@/lib/campaign";
import { CYCLE_DAYS, FUNDS_STEP_CENTS, roundUpToFundsStep } from "@/lib/campaign-plan";

// Auto top-up: the agent saves a card and picks an amount and a level; when their free ad balance drops below
// the level, the card is charged the amount, like Meta's own billing threshold. Pure (client-safe), so the
// settings form, the charger and the tests share the rules. Never more than one charge per COOLDOWN_HOURS,
// so nothing can loop, and never after a failed charge until the agent saves a card again.

export const COOLDOWN_HOURS = 20;
export const MIN_BELOW_CENTS = 10_000;
export const MAX_BELOW_CENTS = 500_000;

/** What a week of ads costs at this daily budget: the default level, so the next weekly cycle is always covered. */
export const weekOfAds = (dailyCents: number) => dailyCents * CYCLE_DAYS;

/** The defaults for an agent spending `dailyCents` a day: top up a week's worth whenever under a week is left. */
export function topUpDefaults(dailyCents: number, plan: FeePlan = "percent") {
  const week = weekOfAds(Math.max(dailyCents, 5000));
  return {
    amountCents: Math.min(MAX_DEPOSIT_CENTS, Math.max(MIN_TOP_UP_CENTS, roundUpToFundsStep(depositFor(week, 0, plan)))),
    belowCents: Math.min(MAX_BELOW_CENTS, Math.max(MIN_BELOW_CENTS, week)),
  };
}

/** The amount and level from untrusted input, or an error in the agent's words. */
export function cleanTopUp(input: { amountCents: unknown; belowCents: unknown }): { amountCents: number; belowCents: number } | string {
  const amount = Math.round(Number(input.amountCents));
  const below = Math.round(Number(input.belowCents));
  if (!Number.isInteger(amount) || amount < MIN_TOP_UP_CENTS || amount > MAX_DEPOSIT_CENTS || amount % FUNDS_STEP_CENTS)
    return `Top up in $${FUNDS_STEP_CENTS / 100} steps, from $${MIN_TOP_UP_CENTS / 100} to $${(MAX_DEPOSIT_CENTS / 100).toLocaleString("en-US")}.`;
  if (!Number.isInteger(below) || below < MIN_BELOW_CENTS || below > MAX_BELOW_CENTS)
    return `Pick a level between $${MIN_BELOW_CENTS / 100} and $${(MAX_BELOW_CENTS / 100).toLocaleString("en-US")}.`;
  return { amountCents: amount, belowCents: below };
}

export type TopUpState = {
  on: boolean;
  hasCard: boolean;
  error: string | null;
  freeBalanceCents: number;
  belowCents: number | null;
  amountCents: number | null;
  lastAt: string | null;
};

/** Whether to charge now, and if not, why (for the logs and the tests). */
export function topUpDue(s: TopUpState, now: Date): { due: true } | { due: false; why: "off" | "no_card" | "failed" | "funded" | "cooldown" } {
  if (!s.on || !s.amountCents || !s.belowCents) return { due: false, why: "off" };
  if (!s.hasCard) return { due: false, why: "no_card" };
  if (s.error) return { due: false, why: "failed" };
  if (s.freeBalanceCents >= s.belowCents) return { due: false, why: "funded" };
  if (s.lastAt && now.getTime() - Date.parse(s.lastAt) < COOLDOWN_HOURS * 3_600_000) return { due: false, why: "cooldown" };
  return { due: true };
}

/** The words the agent agrees to before saving a card, shown on the form and stored with the setup. */
export function topUpConsent(amountCents: number, belowCents: number) {
  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;
  return `I authorize Anryh Labs to charge my saved card ${usd(amountCents)} (including the Anryh Labs fee) whenever my ad balance falls below ${usd(belowCents)}, at most once every ${COOLDOWN_HOURS} hours, until I turn auto top-up off.`;
}
