// How a senior media buyer runs a small life insurance agent's Meta ads: the playbook the strategist,
// the batch planner and the review all reason from, and the budget math that turns it into numbers for
// one agent. Pure (client-safe) and byte-stable so the prompts that include it cache.

/** Meta's learning phase: about 50 optimization events a week per ad set. */
export const LEARNING_EVENTS_PER_WEEK = 50;
/** Until an account has its own cost per booked call, plan on a typical one for life insurance calls. */
export const PLANNING_COST_PER_CALL_CENTS = 6000;
/** Booked calls needed before the account's own cost per call replaces the planning estimate. */
export const MIN_CALLS_FOR_OWN_COST = 3;
/** Below this many impressions an ad's click-through is noise: rank it after the ads that have a real read. */
export const MIN_IMPRESSIONS_TO_RANK = 300;
/** Booked calls a week before Meta should optimize for them directly; under it, optimize for leads. */
export const SCHEDULE_FROM_CALLS_PER_WEEK = 10;
/** Ad spend one ad needs in a week to get a fair read (about 25 clicks at a typical $2 click). */
export const AD_READ_CENTS_PER_WEEK = 5000;
export const MIN_LIVE_ADS = 3;
export const MAX_LIVE_ADS = 6;

/** How many live ads a main ad set's daily budget can give a fair read: 3 at $20/day, 6 from about $43/day. */
export function adsForBudget(dailyCents: number) {
  return Math.max(MIN_LIVE_ADS, Math.min(MAX_LIVE_ADS, Math.floor((dailyCents * 7) / AD_READ_CENTS_PER_WEEK)));
}

export const PLAYBOOK = `The playbook (how a senior media buyer runs a small life insurance agent's Meta ads)

The goal
- The most booked calls from the agent's money, and more money behind what works. Spending is how ads learn and win: never treat a lower spend as a result. Hold back only when the money can't turn into bookings yet (a broken page, no open times, tracking down), and then say what to fix so the next dollar books.
- Judge everything by cost per booked call once there are bookings; before that, by how many people reach the booking page and get as far as picking a time.

Structure follows the budget
- Meta learns per ad set and needs about 50 conversions a week in one ad set to finish learning. A small agent's budget never gets close, so every dollar should feed one ad set: one campaign, one ad set, all the agent's topics as ads inside it, 3 to 5 live ads. Splitting $20/day across 3 ad sets gives each about $7, roughly one booked call a week each: three ad sets that never learn instead of one that does.
- How many ads: each one needs about $50 a week to get a fair read, so $20/day carries 3 live ads, $30/day 4, and $45/day or more 6 (never more: Meta puts most of the money into 2 or 3 anyway, and the rest teach nothing).
- Add a second ad set only for an exploration campaign (new creative tested apart from the proven ads) and only when the budget gives each at least $20/day.
- If an account is already split thinner than its budget supports, consolidate now, carrying the best ads over. One learning restart now beats weeks of ad sets that can't learn.

Targeting and placements
- Financial products is a special ad category: adults 18+ in the licensed states, no age, gender or ZIP targeting. The creative picks the audience, so creative is the biggest lever.
- Facebook and Instagram only. Audience Network and other in-app placements buy accidental clicks that never book.

Creative
- Test one variable at a time. Images are cheap tests of a message; video wins attention. Run every format (4:5 feed image, 9:16 Stories/Reels image, 9:16 reel).
- Give each ad about 1,000 impressions or $15 before judging it; weigh 14 days over 3.
- Make more of what wins (new hooks on a winning body, the winning message in another format) before inventing new angles.

Copy that stops the scroll
- The first line is the hook, under about 10 words, and it must work on its own: a plain benefit ("Final expense coverage, sorted in one 15-minute call."), a warm truth ("Tomorrow's not promised."), or one sourced fact ("A funeral with burial runs about $8,300, per the NFDA."). Then one or two short sentences, one idea each, in plain words a 60-year-old reads at a glance.
- Shapes that keep working in long-running life insurance ads (borrow the shape, never the words): "X is more than Y. It's Z." / "[Coverage] in as little as [time]." (only when true) / "[Product] is a [plain-English definition] designed to [outcome]." / a question the reader answers yes to in their head ("Could your family cover that today?").
- Every ad names the offer: a free consultation call at the agent's call length (free_call_minutes in the snapshot, e.g. "free 15-minute call") and a free quote. End on that call to action.
- Warm, never scolding: protect, plan ahead, together, peace of mind. No guilt, no fear of debt as the whole message.
- Only claims that are true for this agent: no "affordable", "cheapest" or "best rates" (unprovable), no "no medical exam" unless the agent's plan has none, no guarantees, no price promises.

Creative formats that work here
- Warm family moments (a porch dinner, a grandparent and grandchild) with one line of text: "Plan ahead, together." has the best click-through so far.
- The podcast clip: two people at a podcast table, the guest explaining final expense in plain words ("When your family loses you, God forbid, they go through two things... grief, and a bill."), real voices, natural pacing (never sped up), word-by-word captions, a glass stat card for the numbers, strings underneath and no bass drops, ending on the agency's logo. Migz can't make this one (its videos have no one talking on screen); agents supply it, and it should be launched and judged like any other video.
- New Migz videos open with fast cuts (1.5 / 2 / 1.5 / 1 / 3 seconds), then one or two longer shots, with the agent's logo as the end card.

Reading thin data
- Spend is not performance. With no conversions Meta is guessing where to put money, so the ad it spent most on is not the best ad. Rank ads by booked calls, then leads, then link click-through, and only on ads with 300+ impressions; under that, a difference of 1 to 5 clicks is noise. Say "leaning" rather than "winner" until the numbers hold.
- When every ad is inside the noise, the creative isn't the decision: keep them all, add one ad that tests the next thing (a new offer or call to action), and spend enough to get a read. The data that is clear usually points at the page.

Diagnose the funnel before touching creative
- Few people tap -> creative (hook, then body, then copy).
- People tap but don't reach the page -> the page is slow or the clicks are accidental.
- People reach the page but leave before the times -> the ad promises something the top of the page doesn't show.
- People see the times but don't pick one -> the calendar (too few or inconvenient times, unclear on a phone), or the step is too big for cold traffic. New ads won't fix it.
- Clicks cost a normal amount but almost nobody picks a time -> the ad's visitors aren't ready to commit to a call. Lower the first step: show the quote request ("Get a free quote": name and phone, the agent calls back) open to ad visitors, and point the ads' call to action at it. Booking stays first on the page for people who are ready; quote requests become calls when the agent calls back within minutes.

The lowest step people will take, and what Meta learns from
- Meta optimizes for one event and needs about 50 a week in an ad set to learn. A small account books a few calls a week, so an ad set optimizing for booked calls spends blind. Optimize for leads (a quote request or a booked call both count) until the account books about 10 calls a week, then switch to booked calls.
- Leads are how Meta learns; booked calls are still the scoreboard. Judge ads and batches by cost per booked call (cost per lead next to it), never by leads alone: cheap leads that never answer the phone are not a win.
- Switching the event restarts learning: do it once, early in a batch (or when a new batch starts), never in its last days.
- If quote requests rise and bookings fall, the quote option is taking people who would have booked: fold it back under the calendar.
- People pick a time but don't finish -> the form asks too much.

Budget moves
- Change a working ad set's budget by at most 20 to 30% at a time, at most every 3 days; bigger jumps restart learning.
- Scale what books: once cost per booked call is known and steady, recommend more money (a bigger next batch, an exploration campaign) and say how many more calls it should bring at the account's own cost per call.
- Buy a real read: when a batch ends with every ad inside the noise (under 300 impressions each, or a handful of clicks apart), the next batch should put the money into one campaign at a budget that gives every live ad its $50 a week, such as $50/day for 14 days with 6 ads, rather than repeat a small batch that can't tell the ads apart. Never split a small budget across two batches or campaigns to compare them.
- A batch needs time: 7 days to collect results, then revisions, then time to see them work. Don't restructure in a batch's last few days.
- A one-week sprint reads its first 3 days, then revises for the last 4: trim the ads that are clearly behind on day 4, not before. When a batch renews ("Keep going"), the account already has data and Migz can revise from the first day; the ad set keeps its learning, so change as little as the numbers justify and never restart it for its own sake.`;

export type BudgetMath = {
  costPerCallCents: number;
  costSource: "account" | "estimate";
  callsPerWeek: number;
  adsets: number;
  callsPerWeekPerAdset: number;
  /** The daily budget at which one ad set could reach Meta's learning threshold. */
  learningDailyCents: number;
  /** Live ads one ad set at this budget can give a fair read (adsForBudget). */
  ads: number;
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
  const ads = adsForBudget(input.dailyCents);
  const adsText = ` It gives ${ads} live ads about $50 a week each, enough to tell them apart.`;
  const text = consolidate
    ? `${base} Split across ${adsets} ad sets that's about ${usd(input.dailyCents / adsets)}/day and ${calls(perAdset)} a week each, and Meta needs about ${LEARNING_EVENTS_PER_WEEK} a week in one ad set to learn. Put it all in one ad set with every topic's ads inside it.${adsText}`
    : `${base} One ad set gets all of it, so Meta learns from every visit and booking in one place.${adsText}`;
  return { costPerCallCents: cost, costSource, callsPerWeek, adsets, callsPerWeekPerAdset: perAdset, learningDailyCents, ads, verdict: consolidate ? "consolidate" : "keep", text };
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
