import { depositFor } from "@/lib/campaign";

// "Keep going": a batch marked renew starts the same plan again when it ends, from the agent's free ad
// balance. Pure (client-safe) so the rules are tested and the dashboard can say why a renewal didn't run.
// It never charges a card: if the balance doesn't cover the next batch, it waits for funds and tells the
// agent, and gives up after RENEW_WINDOW_DAYS so money added much later doesn't start ads by surprise.

export const RENEW_WINDOW_DAYS = 3;
/** The batch that ended must have spent at least this share of its budget, or the ads weren't delivering. */
export const RENEW_MIN_SPENT = 0.5;

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export type RenewalInput = {
  /** The batch that just ended. */
  batch: { renew: boolean; status: string; ended_at: string | null; budget_cents: number; result: { spent_cents: number } | null };
  agent: { ads_paused: boolean; migz_mode: string; hasMeta: boolean; onboarded: boolean; focusCount: number };
  balanceCents: number;
  /** Needed free on top of the budget: the paid videos Migz makes when it sets the next batch up (0 on Standard). */
  videoCents?: number;
  now: Date;
};

export type Renewal =
  | { action: "skip" }
  | { action: "renew" }
  /** Try again next hour: it's something the agent can fix (funds, a pause). */
  | { action: "wait"; reason: string }
  /** Give up and turn Keep going off: renewing wouldn't put the money to work. */
  | { action: "stop"; reason: string };

export function renewalGate(input: RenewalInput): Renewal {
  const { batch, agent } = input;
  if (!batch.renew || batch.status !== "ended") return { action: "skip" };
  const endedAt = batch.ended_at ? new Date(batch.ended_at).getTime() : input.now.getTime();
  const days = (input.now.getTime() - endedAt) / 86_400_000;
  if (days > RENEW_WINDOW_DAYS) return { action: "stop", reason: `It's been ${Math.floor(days)} days since your last batch ended, so Keep going stopped. Start your next batch when you're ready.` };
  if (!agent.hasMeta || !agent.onboarded || !agent.focusCount)
    return { action: "stop", reason: "Your account isn't set up to run ads, so Keep going stopped." };
  const spent = batch.result?.spent_cents ?? 0;
  if (spent < batch.budget_cents * RENEW_MIN_SPENT)
    return { action: "stop", reason: `Your last batch spent only ${usd(spent)} of its ${usd(batch.budget_cents)}, so the ads weren't delivering and a repeat wouldn't put the money to work. Check your ads, then start the next batch yourself.` };
  if (agent.ads_paused) return { action: "wait", reason: "Your ads are paused, so the next batch hasn't started. Turn them back on and it starts on its own." };
  if (agent.migz_mode === "off") return { action: "wait", reason: "Migz is turned off, so the next batch hasn't started. Turn it back on and it starts on its own." };
  const needed = batch.budget_cents + (input.videoCents ?? 0);
  if (input.balanceCents < needed) {
    const short = needed - input.balanceCents;
    const what = input.videoCents ? `${usd(batch.budget_cents)} batch plus the ${usd(input.videoCents)} of videos Migz makes for it` : usd(batch.budget_cents);
    return { action: "wait", reason: `Your balance is ${usd(input.balanceCents)}, ${usd(short)} short of the ${what} the next batch needs. Add about ${usd(depositFor(short))} in funds and it starts on its own.` };
  }
  return { action: "renew" };
}
