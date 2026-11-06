// What Anryh Labs charges. Shown on the site, in the structured data and in llms.txt, so change it here only.
//
// There is no monthly fee. An agent adds ad funds to their account; we keep 20% of what they add, and the rest
// is their ad budget. Once the total they've added passes $20,000, the fee on everything after that is 12%
// (the first $20,000 always stays at 20%). The dashboard charges the same way (src/lib/campaign.ts); keep the
// two in step. A one-time setup fee comes first.

import { MIN_DEPOSIT_CENTS, SETUP_FEE_CENTS } from "@/lib/campaign";

export const SETUP_FEE = SETUP_FEE_CENTS / 100;
export const MIN_FUNDS = MIN_DEPOSIT_CENTS / 100;

// `upTo` is where the slice ends (the last has none); each slice starts where the one before ended, counting
// everything the agent has added in all
export const TIERS = [
  { upTo: 20000, rate: 0.2 },
  { upTo: null, rate: 0.12 },
] as const;

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
export const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

const startOf = (i: number) => (i === 0 ? 0 : TIERS[i - 1].upTo!);

/** The part of what an agent adds that a tier covers, in words: "the first $20,000 you add", "everything you add after that". */
export function sliceLabel(i: number) {
  const t = TIERS[i];
  if (t.upTo === null) return "everything you add after that";
  return i === 0 ? `the first ${usd(t.upTo)} you add` : `the next ${usd(t.upTo - startOf(i))} you add`;
}

/** The fee, what's left for ads, and how it adds up slice by slice; null below the minimum. */
export function feeFor(funds: number) {
  if (!Number.isFinite(funds) || funds < MIN_FUNDS) return null;
  const slices = TIERS.map((t, i) => {
    const amount = Math.max(0, Math.min(funds, t.upTo ?? Infinity) - startOf(i));
    return { rate: t.rate, amount, fee: Math.round(amount * t.rate), label: sliceLabel(i) };
  }).filter((s) => s.amount > 0);
  const fee = slices.reduce((sum, s) => sum + s.fee, 0);
  return { slices, fee, adBudget: funds - fee, effectiveRate: fee / funds };
}

/** What the fee covers (so the site never has to say "plus creative costs" or "plus tools"). */
export const COVERED = [
  { title: "operations", text: "setting up your campaign, watching it every day, keeping the ad account healthy, and answering you when something looks off." },
  { title: "creative generation", text: "the image and video ads migz ai makes for you, and what it costs to generate them, including new ones as ads wear out." },
  { title: "automation", text: "migz ai running the campaign: reading results through the day, moving budget, pausing what isn't working, within the limits you set." },
] as const;

export const ALSO_INCLUDED = [
  "an instant lead form and a booking page with your calendar",
  "a slack message the moment a lead comes in",
  "optional follow-up emails that start when you tap tried to call",
  "a dashboard with every lead, client and ad result",
];

export const NOT_COVERED = [
  "your licensing, carrier appointments and state filing rules, which stay yours",
  "any promise of leads, appointments or sales: results depend on your market, your offer and how fast you follow up",
];

/** The amount used in worked examples */
export const EXAMPLE_FUNDS = 25000;

/** "20% of the first $20,000 you add and 12% of everything you add after that" */
export const RATES_IN_WORDS = (() => {
  const parts = TIERS.map((t, i) => `${pct(t.rate)} of ${sliceLabel(i)}`);
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
})();

/** One sentence on how the drop works, with a worked example. */
export const HOW_IT_ADDS_UP = (() => {
  const e = feeFor(EXAMPLE_FUNDS)!;
  const line = TIERS[0].upTo;
  return `the total counts everything you've added so far, across all your deposits. the moment it passes ${usd(line)}, the fee on every dollar after that is ${pct(TIERS[1].rate)}; the first ${usd(line)} always stays at ${pct(TIERS[0].rate)}. for example, adding ${usd(EXAMPLE_FUNDS)} in all costs ${usd(e.fee)} (${pct(Math.round(e.effectiveRate * 1000) / 1000)} overall) and puts ${usd(e.adBudget)} into your ads.`;
})();

/** The one-paragraph answer used on the pricing page, the home page and llms.txt. */
export const PRICING_SUMMARY =
  `no monthly fee. there is a one-time ${usd(SETUP_FEE)} setup fee, then we keep a percentage of the ad funds you add: ${RATES_IN_WORDS}. ` +
  `${HOW_IT_ADDS_UP} the minimum is ${usd(MIN_FUNDS)}. the percentage covers operations, creative generation and automation, so there are no extra charges for the ads migz ai makes or the work of running them. the rest of what you add is your ad budget.`;

// Roofing companies: a flat setup paid up front, and a minimum first month of Meta ad spend.
export const ROOFING_SETUP_FEE = 3000;
export const ROOFING_MIN_FIRST_MONTH_AD_SPEND = 2000;
export const ROOFING_PRICING_SUMMARY = `a one-time ${usd(ROOFING_SETUP_FEE)} setup, paid up front, and at least ${usd(ROOFING_MIN_FIRST_MONTH_AD_SPEND)} in meta ad spend for the first month.`;
