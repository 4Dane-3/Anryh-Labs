import { depositFor, MIN_AD_BALANCE_CENTS, TEST_DAYS } from "@/lib/campaign";
import { DateTime } from "luxon";
import { TOPICS, type TopicKey } from "@/lib/migz/topics";
import type { BookingFunnel, FunnelVerdict } from "@/lib/migz/funnel";

// Campaign batches: the agent says how much to put in, Migz lays out ways to spend it. Pure helpers
// (client-safe) so the dialog, the setup page, the start action and the tests all agree.
//
// Every batch runs one main campaign with one ad set, and the agent's topics are compared ad by ad
// inside it. At these budgets, splitting the money across more campaigns leaves each one too little to
// learn from (Meta learns per ad set) and they bid against each other for the same people.
//
// The one exception is an exploration campaign, once the budget covers $20/day for each: new, untested
// creative launches there first and Migz promotes the winners into the main campaign, so the main ad set
// isn't restarted by every test. Every plan advises how much more would make room for one.
//
// Hard limits on every option: at least 14 days (7 days of results, then 7 to revise and check the
// changes worked), at least $20/day per campaign, and the total never above the batch budget.

export const MIN_BATCH_CENTS = MIN_AD_BALANCE_CENTS; // $280 of ads = the $350 minimum deposit after the fee
export const MIN_BATCH_DAYS = TEST_DAYS;
export const MAX_BATCH_DAYS = 42;

// "spread" (several campaigns side by side) is only on older batches
export type BatchOptionKey = "focused" | "balanced" | "explore" | "spread";

/** A campaign in a plan: one topic, null for every focus topic, or the exploration campaign. */
export const EXPLORE = "explore";
export type CampaignSlot = TopicKey | null | typeof EXPLORE;

export const MAIN_MIN_DAILY_CENTS = 2000;
export const EXPLORE_MIN_DAILY_CENTS = 2000;
/** The smallest batch that runs a main and an exploration campaign at $20/day each for two weeks ($560). */
export const EXPLORE_MIN_BATCH_CENTS = (MAIN_MIN_DAILY_CENTS + EXPLORE_MIN_DAILY_CENTS) * MIN_BATCH_DAYS;

export type BatchOption = {
  key: BatchOptionKey;
  title: string;
  campaigns: CampaignSlot[];
  days: number;
  dailyCents: number; // all campaigns together
  perCampaignCents: number; // the main campaign's share
  exploreCents: number; // the exploration campaign's share (0 without one)
  blurb: string;
};

/** What the agent's own results say so far. Only ever this agent's data. */
export type BatchHistory = {
  spentCents: number;
  bookedCalls: number;
  batches: number; // batches that have ended
  byTopic: Partial<Record<TopicKey, { spentCents: number; bookedCalls: number }>>;
  /** Where the ads' visitors stopped on the booking page lately, and why (null when it couldn't be read). */
  page?: { funnel: BookingFunnel; verdict: FunnelVerdict } | null;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** "Final expense", "All your topics and Exploration". Older batches had several campaigns. */
export function listCampaignTopics(slots: CampaignSlot[]) {
  const counts = new Map<string, number>();
  for (const t of slots) counts.set(t ?? "", (counts.get(t ?? "") ?? 0) + 1);
  const parts = [...counts].map(([t, n]) => {
    const label = t === EXPLORE ? "Exploration" : t ? TOPICS[t as TopicKey].label : "All your topics";
    return n > 1 ? `${label} (${n} campaigns)` : label;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
}

/**
 * Each campaign's share of the daily spend, in plan order. The exploration campaign gets 40% (at least
 * $20/day) and the main campaign the rest; older plans split evenly.
 */
export function splitDaily(dailyCents: number, slots: readonly CampaignSlot[]): number[] {
  const n = slots.length;
  if (!slots.includes(EXPLORE) || n < 2) return slots.map(() => Math.floor(dailyCents / Math.max(1, n)));
  const explore = Math.min(dailyCents - MAIN_MIN_DAILY_CENTS, Math.max(EXPLORE_MIN_DAILY_CENTS, Math.round(dailyCents * 0.4)));
  const mains = n - 1;
  return slots.map((t) => (t === EXPLORE ? explore : Math.floor((dailyCents - explore) / mains)));
}

/**
 * What adding money would unlock: a $20/day exploration campaign next to the main one. Null once the
 * budget already covers it (the explore option is then on offer).
 */
export function exploreAdvice(budgetCents: number) {
  if (budgetCents >= EXPLORE_MIN_BATCH_CENTS) return null;
  const addCents = EXPLORE_MIN_BATCH_CENTS - budgetCents;
  return {
    addCents,
    totalCents: EXPLORE_MIN_BATCH_CENTS,
    depositCents: depositFor(addCents),
    exploreDailyCents: EXPLORE_MIN_DAILY_CENTS,
    days: MIN_BATCH_DAYS,
    message: `Add ${dollars(addCents)} to this batch (${dollars(EXPLORE_MIN_BATCH_CENTS)} in total) and Migz also runs a ${dollars(EXPLORE_MIN_DAILY_CENTS)}/day exploration campaign for ${MIN_BATCH_DAYS} days. New ideas get tested there first, so your main campaign keeps learning instead of restarting with every new ad, and the winners move over.`,
  };
}

function exploreOption(budgetCents: number, main: TopicKey | null): BatchOption | null {
  if (budgetCents < EXPLORE_MIN_BATCH_CENTS) return null;
  // Aims for about $50/day across both and runs longer with more money
  const days = clamp(Math.floor(budgetCents / 5000), MIN_BATCH_DAYS, MAX_BATCH_DAYS);
  const dailyCents = Math.floor(budgetCents / days);
  const campaigns: CampaignSlot[] = [main, EXPLORE];
  const [mainCents, exploreCents] = splitDaily(dailyCents, campaigns);
  const what = main ? `${TOPICS[main].label} ads` : "ads on all your topics";
  return {
    key: "explore",
    title: "Main + exploration",
    campaigns,
    days,
    dailyCents,
    perCampaignCents: mainCents,
    exploreCents,
    blurb: `A main campaign at ${dollars(mainCents)}/day with your proven ${what}, plus an exploration campaign at ${dollars(exploreCents)}/day for ${days} days. New hooks, formats and topics are tested in exploration first; Migz moves the winners into the main campaign, so it keeps learning instead of restarting with every new ad.`,
  };
}

function option(key: "focused" | "balanced", budgetCents: number, topic: TopicKey | null, focus: TopicKey[], days: number): BatchOption {
  const dailyCents = Math.floor(budgetCents / days);
  const per = dollars(dailyCents);
  const labels = focus.map((t) => TOPICS[t].label);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] ?? "";
  const copy = {
    focused: {
      title: "Focused",
      blurb: `All in on ${listCampaignTopics([topic])}: one campaign at ${per}/day for ${days} days, with every ad on that topic. Migz compares hooks and formats inside it.`,
    },
    balanced: {
      title: "All your topics",
      blurb: `One campaign at ${per}/day for ${days} days, with ads on ${list} side by side. Meta puts the money behind the ads that book, and Migz compares the topics ad by ad.`,
    },
  };
  return { key, ...copy[key], campaigns: [topic], days, dailyCents, perCampaignCents: dailyCents, exploreCents: 0 };
}

/**
 * The ways Migz could spend a batch: one campaign focused on one topic (the agent's best once there is
 * one, otherwise the main focus), one campaign with ads on every focus topic side by side, and, once the
 * budget covers $20/day for each, a main campaign plus an exploration campaign. With a single focus the
 * first two are the same, so there's one of them. Empty when the budget is under the minimum.
 */
export function batchOptions(budgetCents: number, focus: TopicKey[], bestTopic: TopicKey | null = null): BatchOption[] {
  if (budgetCents < MIN_BATCH_CENTS) return [];
  const days = clamp(Math.floor(budgetCents / 2000), MIN_BATCH_DAYS, MAX_BATCH_DAYS);
  const lead = bestTopic ?? focus[0] ?? null;
  const single = focus.length < 2 ? [option("focused", budgetCents, lead, focus, days)] : [option("focused", budgetCents, lead, focus, days), option("balanced", budgetCents, null, focus, days)];
  const explore = exploreOption(budgetCents, bestTopic ?? (focus.length === 1 ? focus[0] : null));
  return explore ? [...single, explore] : single;
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
  if (has("explore")) {
    return {
      key: "explore",
      reason: best
        ? `${TOPICS[best].label} books calls clearly cheaper, so it leads the main campaign while new ideas are tested in exploration without restarting it.`
        : "Your budget covers an exploration campaign: new ideas get tested there while the main campaign keeps learning, and Migz moves the winners over.",
    };
  }
  if (best && has("focused")) {
    return { key: "focused", reason: `${TOPICS[best].label} books calls clearly cheaper than your other topics, so putting this batch behind it should bring the most calls.` };
  }
  if (!has("balanced")) return { key: "focused", reason: "One campaign on your focus, so all the money and data go to one place while Migz compares ads inside it." };
  if (history.bookedCalls < 3) {
    return { key: "balanced", reason: "There isn't enough booking data yet to pick a winner, so one campaign runs ads on each of your topics and Meta backs whichever ones book." };
  }
  return { key: "balanced", reason: "No topic books clearly cheaper yet, so keep ads on all of them in one campaign while Migz learns." };
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

// ---------- Staying inside the batch ----------

/**
 * Meta may spend up to 25% more than an ad set's daily budget on a given day, evening it out over the
 * week. Mid-batch that averages away; in the last week there's no time left to even out, so a batch
 * paced at exactly budget/days could finish over. Migz plans for it (pacedDailyCents) and Meta stops
 * delivery itself at the batch's end time (batchEndTime).
 */
export const META_DAILY_FLEX = 0.25;
export const FINAL_STRETCH_DAYS = 7;

/**
 * The most the batch's campaigns may be set to spend per day right now so the batch can't go over its
 * budget even if Meta runs 25% hot. Never above the plan. 0 means the budget is used up: stop.
 * - Before the last week: what's left spread evenly (Meta's weekly averaging keeps spend near this).
 * - In the last week: what's left assuming every remaining day runs 25% over.
 */
export function pacedDailyCents(input: { budgetCents: number; spentCents: number; daysLeft: number; plannedDailyCents: number }) {
  const remaining = input.budgetCents - input.spentCents;
  if (remaining <= 0 || input.daysLeft <= 0) return 0;
  const flex = input.daysLeft <= FINAL_STRETCH_DAYS ? 1 + META_DAILY_FLEX : 1;
  return Math.max(0, Math.min(input.plannedDailyCents, Math.floor(remaining / (input.daysLeft * flex))));
}

/** The moment Meta should stop delivering: the end of the batch's last day, in the agent's timezone. */
export function batchEndTime(endsOn: string, timezone: string) {
  return DateTime.fromISO(endsOn, { zone: timezone }).endOf("day").set({ millisecond: 0 }).toISO({ suppressMilliseconds: true })!;
}
