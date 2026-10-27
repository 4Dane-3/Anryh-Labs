// How a senior media buyer runs a small life insurance agent's Meta ads: the playbook the strategist,
// the batch planner and the review all reason from, and the budget math that turns it into numbers for
// one agent. Pure (client-safe) and byte-stable so the prompts that include it cache.

/** Meta's learning phase: about 50 optimization events a week per ad set. */
export const LEARNING_EVENTS_PER_WEEK = 50;
/** Until an account has its own cost per booked call, plan on a typical one for life insurance calls. */
export const PLANNING_COST_PER_CALL_CENTS = 6000;
/** Booked calls needed before the account's own cost per call replaces the planning estimate. */
export const MIN_CALLS_FOR_OWN_COST = 3;

export const PLAYBOOK = `The playbook (how a senior media buyer runs a small life insurance agent's Meta ads)

The goal
- The most booked calls from the agent's money, and more money behind what works. Spending is how ads learn and win: never treat a lower spend as a result. Hold back only when the money can't turn into bookings yet (a broken page, no open times, tracking down), and then say what to fix so the next dollar books.
- Judge everything by cost per booked call once there are bookings; before that, by how many people reach the booking page and get as far as picking a time.

Structure follows the budget
- Meta learns per ad set and needs about 50 conversions a week in one ad set to finish learning. A small agent's budget never gets close, so every dollar should feed one ad set: one campaign, one ad set, all the agent's topics as ads inside it, 3 to 5 live ads. Splitting $20/day across 3 ad sets gives each about $7, roughly one booked call a week each: three ad sets that never learn instead of one that does.
- Add a second ad set only for an exploration campaign (new creative tested apart from the proven ads) and only when the budget gives each at least $20/day.
- If an account is already split thinner than its budget supports, consolidate now, carrying the best ads over. One learning restart now beats weeks of ad sets that can't learn.

Targeting and placements
- Financial products is a special ad category: adults 18+ in the licensed states, no age, gender or ZIP targeting. The creative picks the audience, so creative is the biggest lever.
- Facebook and Instagram only. Audience Network and other in-app placements buy accidental clicks that never book.

Creative
- Test one variable at a time. Images are cheap tests of a message; video wins attention. Run every format (4:5 feed image, 9:16 Stories/Reels image, 9:16 reel).
- Give each ad about 1,000 impressions or $15 before judging it; weigh 14 days over 3.
- Make more of what wins (new hooks on a winning body, the winning message in another format) before inventing new angles.

Diagnose the funnel before touching creative
- Few people tap -> creative (hook, then body, then copy).
- People tap but don't reach the page -> the page is slow or the clicks are accidental.
- People reach the page but leave before the times -> the ad promises something the top of the page doesn't show.
- People see the times but don't pick one -> the calendar (too few or inconvenient times, unclear on a phone). New ads won't fix it.
- People pick a time but don't finish -> the form asks too much.

Budget moves
- Change a working ad set's budget by at most 20 to 30% at a time, at most every 3 days; bigger jumps restart learning.
- Scale what books: once cost per booked call is known and steady, recommend more money (a bigger next batch, an exploration campaign) and say how many more calls it should bring at the account's own cost per call.
- A batch needs time: 7 days to collect results, then revisions, then time to see them work. Don't restructure in a batch's last few days.`;

export type BudgetMath = {
  costPerCallCents: number;
  costSource: "account" | "estimate";
  callsPerWeek: number;
  adsets: number;
  callsPerWeekPerAdset: number;
  /** The daily budget at which one ad set could reach Meta's learning threshold. */
  learningDailyCents: number;
  verdict: "consolidate" | "keep";
  text: string;
};

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const calls = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ""));

/** The account's own cost per booked call once it has enough bookings to trust, else null. */
export function ownCostPerCall(spentCents: number, bookedCalls: number) {
  return bookedCalls >= MIN_CALLS_FOR_OWN_COST ? Math.round(spentCents / bookedCalls) : null;
}

/**
 * What a daily budget can buy and how many ad sets it supports: booked calls a week at the account's
 * own cost per call (or the planning estimate), split across `adsets` live main ad sets.
 */
export function budgetMath(input: { dailyCents: number; adsets: number; costPerCallCents: number | null }): BudgetMath {
  const costSource = input.costPerCallCents ? "account" : "estimate";
  const cost = input.costPerCallCents ?? PLANNING_COST_PER_CALL_CENTS;
  const adsets = Math.max(1, input.adsets);
  const callsPerWeek = (input.dailyCents * 7) / cost;
  const perAdset = callsPerWeek / adsets;
  const learningDailyCents = Math.round((LEARNING_EVENTS_PER_WEEK * cost) / 7);
  const costWords = costSource === "account" ? `your ${usd(cost)} per booked call` : `about ${usd(cost)} per booked call (a typical cost until your own ads have ${MIN_CALLS_FOR_OWN_COST} bookings)`;
  const base = `${usd(input.dailyCents)}/day at ${costWords} is about ${calls(callsPerWeek)} booked call${callsPerWeek >= 0.95 && callsPerWeek < 1.05 ? "" : "s"} a week.`;
  // More ad sets than the budget can feed: each gets a slice too small to learn from
  const consolidate = adsets > 1 && perAdset < LEARNING_EVENTS_PER_WEEK;
  const text = consolidate
    ? `${base} Split across ${adsets} ad sets that's about ${usd(input.dailyCents / adsets)}/day and ${calls(perAdset)} a week each, and Meta needs about ${LEARNING_EVENTS_PER_WEEK} a week in one ad set to learn. Put it all in one ad set with every topic's ads inside it.`
    : `${base} One ad set gets all of it, so Meta learns from every visit and booking in one place.`;
  return { costPerCallCents: cost, costSource, callsPerWeek, adsets, callsPerWeekPerAdset: perAdset, learningDailyCents, verdict: consolidate ? "consolidate" : "keep", text };
}

/** How many more booked calls more money should bring, at the account's own cost per call (null before it has one). */
export function scaleAdvice(input: { spentCents: number; bookedCalls: number; extraCents: number }) {
  const cost = ownCostPerCall(input.spentCents, input.bookedCalls);
  if (!cost) return null;
  const more = input.extraCents / cost;
  return {
    costPerCallCents: cost,
    extraCalls: more,
    text: `At your ${usd(cost)} per booked call, another ${usd(input.extraCents)} of ad spend should bring about ${calls(more)} more booked call${more >= 0.95 && more < 1.05 ? "" : "s"}.`,
  };
}
