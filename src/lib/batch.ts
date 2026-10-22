import {
  allocateCampaigns,
  CAMPAIGN_DAILY_CENTS,
  MAX_CAMPAIGNS,
  MIN_AD_BALANCE_CENTS,
  TEST_DAYS,
} from "@/lib/campaign";
import { TOPICS, type TopicKey } from "@/lib/migz/topics";

// Campaign batches: the agent says how much to put in, Migz lays out ways to spend it. Pure helpers
// (client-safe) so the dialog, the setup page, the start action and the tests all agree.
//
// Hard limits on every option: at least 14 days (7 days of results, then 7 to revise and check the
// changes worked), at least $10/day per campaign, and the total never above the batch budget.

export const MIN_BATCH_CENTS = MIN_AD_BALANCE_CENTS; // $280 of ads = the $350 minimum deposit after the fee
export const MIN_BATCH_DAYS = TEST_DAYS;
export const MAX_BATCH_DAYS = 42;

export type BatchOptionKey = "focused" | "balanced" | "spread";

export type BatchOption = {
  key: BatchOptionKey;
  title: string;
  campaigns: (TopicKey | null)[];
  days: number;
  dailyCents: number; // all campaigns together
  perCampaignCents: number;
  blurb: string;
};

/** What the agent's own results say so far. Only ever this agent's data. */
export type BatchHistory = {
  spentCents: number;
  bookedCalls: number;
  batches: number; // batches that have ended
  byTopic: Partial<Record<TopicKey, { spentCents: number; bookedCalls: number }>>;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** The most campaigns a budget can run for the minimum length at $10/day each. */
export function maxCampaigns(budgetCents: number) {
  return Math.min(MAX_CAMPAIGNS, Math.floor(budgetCents / (CAMPAIGN_DAILY_CENTS * MIN_BATCH_DAYS)));
}

/** "Mortgage protection and Final expense", "Final expense (2 campaigns) and Income protection". */
export function listCampaignTopics(slots: (TopicKey | null)[]) {
  const counts = new Map<string, number>();
  for (const t of slots) counts.set(t ?? "", (counts.get(t ?? "") ?? 0) + 1);
  const parts = [...counts].map(([t, n]) => {
    const label = t ? TOPICS[t as TopicKey].label : "Booked calls";
    return n > 1 ? `${label} (${n} campaigns)` : label;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
}

function option(key: BatchOptionKey, budgetCents: number, campaigns: (TopicKey | null)[], days: number): BatchOption {
  const dailyCents = Math.floor(budgetCents / days);
  const perCampaignCents = Math.floor(dailyCents / campaigns.length);
  const per = dollars(perCampaignCents);
  const n = campaigns.length;
  const copy: Record<BatchOptionKey, { title: string; blurb: string }> = {
    focused: {
      title: "Focused",
      blurb: `All in on ${listCampaignTopics(campaigns)}: one campaign at ${per}/day for ${days} days. Deeper data on one topic; Migz compares ads inside it instead of campaigns.`,
    },
    balanced: {
      title: "Balanced",
      blurb: `${listCampaignTopics(campaigns)}: ${n} campaigns at ${per}/day each for ${days} days, so each focus gets its own test.`,
    },
    spread: {
      title: "Spread",
      blurb: `${n} campaigns at ${per}/day each for ${days} days: ${listCampaignTopics(campaigns)}. Tests the most angles at once, then Migz backs the winners.`,
    },
  };
  return { key, ...copy[key], campaigns, days, dailyCents, perCampaignCents };
}

/**
 * The ways Migz could spend a batch: one focused campaign (on the agent's best topic once there is one,
 * otherwise the main focus), one campaign per focus, or as many campaigns as the money allows. Options
 * that come out the same are dropped. Empty when the budget is under the minimum.
 */
export function batchOptions(budgetCents: number, focus: TopicKey[], bestTopic: TopicKey | null = null): BatchOption[] {
  if (budgetCents < MIN_BATCH_CENTS) return [];
  const maxN = Math.max(2, maxCampaigns(budgetCents));
  // Focused aims for $20/day (enough for Meta to learn quickly) and runs longer with more money
  const lead = bestTopic ?? focus[0] ?? null;
  const focused = option("focused", budgetCents, [lead], clamp(Math.floor(budgetCents / 2000), MIN_BATCH_DAYS, MAX_BATCH_DAYS));
  // Balanced: one per focus (2 at least, so there's a comparison), aiming for $15/day each
  const nb = Math.min(maxN, Math.max(2, focus.length));
  const balanced = option("balanced", budgetCents, allocateCampaigns(focus, nb), clamp(Math.floor(budgetCents / (nb * 1500)), MIN_BATCH_DAYS, MAX_BATCH_DAYS));
  // Spread: as many campaigns as the minimum length allows
  const spread = option("spread", budgetCents, allocateCampaigns(focus, maxN), MIN_BATCH_DAYS);
  return [focused, balanced, ...(spread.campaigns.length > balanced.campaigns.length ? [spread] : [])];
}

/** Cost per booked call by topic, for topics with enough calls to trust. */
function topicCosts(history: BatchHistory) {
  return (Object.entries(history.byTopic) as [TopicKey, { spentCents: number; bookedCalls: number }][])
    .filter(([, t]) => t.bookedCalls >= 3)
    .map(([topic, t]) => ({ topic, cost: t.spentCents / t.bookedCalls }))
    .sort((a, b) => a.cost - b.cost);
}

/** A topic that books calls clearly cheaper than the rest (30%+), or null. */
export function bestTopic(history: BatchHistory): TopicKey | null {
  const costs = topicCosts(history);
  if (costs.length < 2) return null;
  return costs[0].cost <= costs[1].cost * 0.7 ? costs[0].topic : null;
}

/** The plan Migz would pick without asking a model: used instantly, and as the fallback. */
export function recommendOption(options: BatchOption[], focus: TopicKey[], history: BatchHistory): { key: BatchOptionKey; reason: string } {
  const has = (k: BatchOptionKey) => options.some((o) => o.key === k);
  const best = bestTopic(history);
  if (best && has("focused")) {
    return { key: "focused", reason: `${TOPICS[best].label} books calls clearly cheaper than your other topics, so putting this batch behind it should bring the most calls.` };
  }
  if (history.bookedCalls < 3) {
    return {
      key: "balanced",
      reason: focus.length > 1
        ? "There isn't enough booking data yet to pick a winner, so one campaign per focus finds your best topic fastest."
        : "There isn't enough booking data yet, so two campaigns on your focus let Migz compare two approaches.",
    };
  }
  if (has("spread")) return { key: "spread", reason: "No topic is a clear winner yet, so testing more campaigns at once should find one sooner." };
  return { key: "balanced", reason: "No topic is a clear winner yet, so each focus keeps its own campaign while Migz learns." };
}

/** Booked calls the budget should bring, from the agent's own cost per call. Null until there's data. */
export function outcomeEstimate(budgetCents: number, history: BatchHistory) {
  if (history.bookedCalls < 3 || history.spentCents <= 0) return null;
  const cost = history.spentCents / history.bookedCalls;
  return {
    costPerCallCents: Math.round(cost),
    low: Math.max(1, Math.floor(budgetCents / (cost * 1.25))),
    high: Math.max(1, Math.ceil(budgetCents / (cost * 0.85))),
  };
}

/** Re-derives the option the agent picked, so the server never trusts the client's numbers. */
export function findOption(budgetCents: number, focus: TopicKey[], key: string, best: TopicKey | null = null) {
  return batchOptions(budgetCents, focus, best).find((o) => o.key === key) ?? null;
}
