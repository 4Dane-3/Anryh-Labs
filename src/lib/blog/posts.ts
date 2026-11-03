import { HOW_IT_ADDS_UP, RATES_IN_WORDS, SETUP_FEE, feeFor, pct, usd } from "@/lib/pricing";
import type { Faq } from "@/lib/seo/insurance-types";

// The blog: plain answers to the questions life insurance agents (and the AI assistants they ask) put to
// search. Each post opens with a short answer, then the detail. Rendered by /blog and /blog/[slug].

export type Block = { h: string } | { p: string } | { ul: string[] };

export type Post = {
  slug: string;
  title: string;
  description: string;
  /** the direct answer, shown first and used as the summary */
  answer: string;
  date: string;
  updated: string;
  body: Block[];
  faqs?: Faq[];
  types?: string[]; // insurance-type page slugs worth linking
};

const DATE = "2026-11-02";

const example = (funds: number) => {
  const f = feeFor(funds)!;
  return `add ${usd(funds)}: ${usd(f.fee)} fee (${pct(Math.round(f.effectiveRate * 1000) / 1000)} overall), ${usd(f.adBudget)} goes to your ads`;
};

export const POSTS: Post[] = [
  {
    slug: "facebook-ads-cost-life-insurance-agents",
    title: "how much do facebook ads cost for life insurance agents?",
    description: "what life insurance agents pay for facebook and instagram ads: the three costs, why cost per lead varies, and how to budget.",
    answer:
      "there is no fixed price. you pay meta for ad delivery out of a budget you choose, and your cost per lead moves with your state, your offer, the season and how good the ads are. plan around three things: the daily budget you set, the fee of whoever runs the ads, and the cost per lead you measure in your first weeks.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "the three costs" },
      { ul: [
        "ad spend: what you pay meta so your ads are shown. you set a daily or total budget and meta spends against it.",
        "management: who runs the ads. that is you, a freelancer, an agency or software, and they charge a flat fee, a percentage of ad spend or a price per lead.",
        "creative: the images and videos. some services include them and some charge for each one.",
      ] },
      { h: "why cost per lead varies" },
      { ul: [
        "your states and audience: some markets are more crowded than others.",
        "your offer and next step: an instant form usually costs less per lead than a booking page, because it is easier to complete.",
        "your creative: fresh, clear ads cost less per lead than tired ones, and every ad wears out.",
        "the season: busy advertising periods, like the end of the year, raise costs for everyone.",
      ] },
      { h: "cost per lead is not cost per client" },
      { p: "a cheap lead nobody answers is expensive. track four numbers instead of one: cost per lead, the share of leads you reach, the share of those who book or buy, and the cost per policy. an ad that looks costly per lead can be the cheapest per client." },
      { h: "how to budget" },
      { ul: [
        "pick a daily budget you can keep up for at least a month. meta needs time to learn, and a campaign judged after two days tells you very little.",
        "decide the first number you will judge by: cost per lead, then how many you reach.",
        "mark every lead's outcome. that is the only way to learn which ads bring people who answer.",
      ] },
      { h: "what anryh labs charges" },
      { p: `a one-time ${usd(SETUP_FEE)} setup fee, then a percentage of the ad funds you add that covers operations, creative generation and automation. the rest is your ad budget. see the pricing page for the rates.` },
    ],
    faqs: [
      { q: "what is a good cost per lead for life insurance?", a: "it depends on your market, offer and season, so compare against your own results over a few weeks instead of a number from someone else's account. a lower cost per lead only matters if you reach the people." },
      { q: "how much should a new agent spend on facebook ads?", a: "enough to give meta time to learn, which means a budget you can keep up for at least a month. anryh labs starts at a minimum of $1,000 in ad funds, enough for $50/day over a 2-week cycle, and campaigns keep rolling as long as you keep funds in." },
    ],
    types: ["final-expense", "mortgage-protection"],
  },
  {
    slug: "instant-forms-vs-booking-page-life-insurance",
    title: "instant forms or a booking page: which gets life insurance agents better leads?",
    description: "instant lead forms bring more leads for less; booking pages bring fewer, warmer ones. how to choose, and why many agents run both.",
    answer:
      "instant forms usually bring more leads at a lower cost per lead, because people sign up without leaving facebook. booking pages bring fewer leads, but those people have already picked a time. neither wins for everyone: form leads need faster and more persistent follow-up, and booking-page leads are warmer. many agents run both and compare the cost of a reached lead.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "how each works" },
      { ul: [
        "instant form: the ad opens a short form inside facebook or instagram with the person's details filled in. they tap submit and you get the lead.",
        "booking page: the ad opens your page, where the person chooses a day and time for a call.",
      ] },
      { h: "the trade-offs" },
      { ul: [
        "volume: forms are easier to finish, so there are more of them.",
        "intent: a booking is a decision, a form submission is an impulse. expect more form leads who do not answer.",
        "speed: the faster you call a form lead, the better your odds, because they were looking at facebook a moment ago.",
        "cost per lead is lower for forms, but compare cost per reached lead, not cost per lead.",
      ] },
      { h: "what to do with form leads" },
      { ul: [
        "call as soon as you are told about the lead.",
        "if they do not answer, mark tried to call and follow up by email.",
        "try again at a different time of day.",
        "mark every outcome, so you can see which ads bring people who answer.",
      ] },
      { h: "running both" },
      { p: "migz ai can run an instant-form ad set and a booking-page ad set side by side when the budget is large enough to split, so you see the cost per lead, the cost per reached lead and the cost per booked call for each." },
    ],
    faqs: [
      { q: "which is better for final expense, a form or a booking page?", a: "final expense leads are often phone-first, so many agents lean on instant forms and follow up quickly. it depends on how fast you can call, so compare the two on your own numbers." },
      { q: "can i use both at once?", a: "yes. running both for a few weeks is the cleanest way to find out which brings people you actually reach." },
    ],
    types: ["final-expense", "indexed-universal-life"],
  },
  {
    slug: "ai-media-buyer-for-insurance-agents",
    title: "what is an ai media buyer for insurance agents?",
    description: "an ai media buyer builds and runs your ads for you. what it does, what it can't do, and what to ask before you trust one with your ad account.",
    answer:
      "an ai media buyer is software that does the work of a person who buys ads: it builds the campaign, creates the ads, checks results every day, moves budget and pauses what isn't working. for insurance agents it also has to handle lead alerts, compliant copy and follow-up. migz ai from anryh labs is one.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "what a media buyer does" },
      { ul: [
        "sets up campaigns, audiences and budgets",
        "gets ads made and tests them against each other",
        "reads results daily and shifts money toward what works",
        "pauses ads that spend without producing leads",
      ] },
      { h: "what the ai version adds" },
      { p: "it works all day, every day, and explains each change. migz ai checks results through the day, writes a plain reason for every move and tells you when the right move is to wait." },
      { h: "what it cannot do" },
      { ul: [
        "hold your license, call your leads or close a sale",
        "promise leads or sales. results depend on your market, your offer and how fast you follow up",
        "decide your state's compliance questions for you",
      ] },
      { h: "what to ask before you trust one" },
      { ul: [
        "whose ad account does it run in, and can i remove its access?",
        "can it spend more than the budget i set?",
        "can i see why it made each change?",
        "what happens to my leads and data if i leave?",
      ] },
      { h: "how migz ai answers those" },
      { p: "the ads run in your own meta ad account and you can remove access in your facebook settings. migz ai has hard limits it can't cross, shows its reasoning in your dashboard, and the leads are yours." },
    ],
    faqs: [
      { q: "is an ai media buyer better than an agency?", a: "it is different. it works every day and can show the reason for every decision. an agency can offer a person to talk to. what matters is who owns the ad account, what is included and whether you can see the reasoning." },
    ],
    types: ["whole-life", "income-protection"],
  },
  {
    slug: "mortgage-protection-facebook-ads",
    title: "how to run mortgage protection ads on facebook",
    description: "what mortgage protection ads should say, what meta and your state restrict, and how to follow up on the leads.",
    answer:
      "good mortgage protection ads speak to a situation, keeping the family in the home if the paycheck stops, and invite a conversation. they do not tell the viewer they own a home, quote rates or promise approval, because meta's policies and state advertising rules restrict those claims.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "what the ad needs" },
      { ul: [
        "a clear situation: who pays the mortgage if something happens",
        "everyday home scenes: the front door, the kitchen, the kids' rooms",
        "one simple next step: a short form or a call booking",
      ] },
      { h: "what to avoid" },
      { ul: [
        "telling the viewer they own a home, their age or their health. meta does not allow ads that assert or imply personal details",
        "quoting rates, promising approval or promising savings",
        "claims your carrier or state has not cleared",
      ] },
      { h: "the next step" },
      { p: "an instant form gets more people to raise a hand. a booking page gets fewer who have picked a time. either way, call quickly and follow up more than once." },
      { h: "testing" },
      { p: "run several ads with different hooks and let results decide. judge them by how many of their leads you reach, not only by cost per lead." },
      { h: "how migz ai handles it" },
      { p: "mortgage protection is one of the focus topics. migz ai makes the images and videos, runs them in the states you are licensed in and tells you on slack when a lead arrives." },
    ],
    faqs: [
      { q: "can mortgage protection ads mention homeownership?", a: "the ad can talk about the situation of keeping a family in their home. it should not state or imply that the viewer owns one, because meta does not allow ads that assert personal details about the viewer." },
    ],
    types: ["mortgage-protection"],
  },
  {
    slug: "final-expense-facebook-ads",
    title: "final expense facebook ads: what to say and what meta allows",
    description: "how to write final expense ads that get leads without breaking meta's rules about age, health and personal details.",
    answer:
      "final expense ads work when they speak to the family's situation, so nobody is left with the bill, and state who the offer is for as a range. they fail when they tell the viewer their age or health, promise approval or use fear. meta restricts ads that assert or imply personal details.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "what works" },
      { ul: [
        "warm, dignified family moments across generations",
        "the benefit in the family's words: not leaving the kids with the bill",
        "the audience as a range or condition: \"for people 50–85\" or \"if you are between 50 and 85\"",
        "one clear next step",
      ] },
      { h: "what gets ads rejected" },
      { ul: [
        "telling the viewer their age, health or finances",
        "promising approval, rates or that no one can be turned down",
        "fear, shock or pressure",
      ] },
      { h: "images and video" },
      { p: "test both. short videos often explain the idea better, and images are quick to read. refresh them when results tire." },
      { h: "after the form" },
      { p: "final expense leads often need more than one try. call fast, follow up by email and mark your outcomes, so you can see which ads bring people who answer." },
    ],
    faqs: [
      { q: "can i say 'if you are over 50' in a final expense ad?", a: "describe who the offer is for as a range or condition rather than telling the viewer who they are. check meta's current policy and your state's rules before you publish." },
    ],
    types: ["final-expense"],
  },
  {
    slug: "exclusive-leads-vs-own-ads",
    title: "exclusive leads vs running your own ads: what's the difference for agents?",
    description: "buying leads is quick to start; running your own ads gives you leads you own. how to compare them on cost per reached lead and per policy.",
    answer:
      "buying leads is fast and priced per lead, but you do not control how a lead was made, whether it was shared or how fresh it is. running your own ads takes setup and a learning period, but the leads are yours alone, and the ad account's history and data stay with you.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "bought leads" },
      { ul: [
        "start fast, with no setup",
        "priced per lead, which is easy to budget",
        "quality and exclusivity depend on the seller, and you cannot see how the lead was made",
      ] },
      { h: "your own ads" },
      { ul: [
        "the leads are yours alone",
        "the ad account, pixel history and data stay yours if you change provider",
        "it takes a few weeks to learn, and costs move with the market",
      ] },
      { h: "how to compare them" },
      { p: "compare the cost per reached lead and the cost per policy, not the cost per lead. track how many you reach, how many book and how many buy over at least a month." },
      { h: "questions for any lead seller" },
      { ul: [
        "is the lead exclusive or sold to others?",
        "how is the lead made, and where is the consent recorded?",
        "what happens with bad numbers, duplicates and out-of-state leads?",
        "is there a minimum order or a contract?",
      ] },
    ],
    faqs: [
      { q: "are leads from my own facebook ads exclusive?", a: "yes. they come from your ads and your forms in your own ad account, so they are not sold or shared with anyone else." },
    ],
    types: ["final-expense", "policy-review"],
  },
  {
    slug: "follow-up-facebook-leads-insurance",
    title: "how fast should an insurance agent follow up on a facebook lead?",
    description: "call within minutes, then follow up more than once. a simple follow-up sequence for facebook and instagram leads.",
    answer:
      "as fast as you can, and more than once. a facebook lead signed up on impulse and is thinking about it now. call first, follow up by email where you have permission, try again at a different time and keep a record of every attempt.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "why speed matters" },
      { p: "the person was on facebook a moment ago and is thinking about it now. every hour that passes, the moment fades and another agent's ad can take its place." },
      { h: "a simple sequence" },
      { ul: [
        "call as soon as you hear about the lead",
        "no answer: mark tried to call, and send a short email",
        "call again at a different time of day, such as early evening",
        "follow up once or twice more over the next days, then stop",
        "mark the outcome: reached, booked, sold or not interested",
      ] },
      { h: "stay inside the rules" },
      { p: "calls and texts to people are covered by rules like the TCPA and do-not-call lists, and email by CAN-SPAM. only contact people who asked to hear from you, and ask your compliance contact or an attorney about your own situation." },
      { h: "what to track" },
      { ul: [
        "how fast you first called",
        "the share of leads you reached",
        "the share that booked",
        "which ads the best leads came from",
      ] },
      { h: "how migz ai helps" },
      { p: "it messages you on slack the moment a lead arrives, starts the follow-up emails when you tap tried to call (if you choose that), and uses the outcomes you mark to learn which ads bring people who answer." },
    ],
    faqs: [
      { q: "how many times should i call a facebook lead?", a: "more than once, at different times of day, over several days. then stop. record each attempt so you know what you tried." },
    ],
    types: ["final-expense", "mortgage-protection"],
  },
  {
    slug: "percentage-of-ad-spend-pricing-insurance-agents",
    title: "how percentage-of-ad-spend pricing works for insurance agent ads",
    description: "what it means when ad management is priced as a percentage of the budget you add, what to ask, and how anryh labs's tiers work.",
    answer:
      "percentage-of-ad-spend pricing means whoever runs your ads keeps a share of the money you add. it is common because it grows with the work. to judge it, ask what the percentage covers, whether it comes out of your budget or on top of it, and how the rate changes as you add more.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "the common ways to pay" },
      { ul: [
        "a percentage of ad spend",
        "a flat monthly retainer",
        "a price per lead",
      ] },
      { h: "what to ask" },
      { ul: [
        "what does the percentage cover: ad creative, tools and reporting, or only the management?",
        "is it taken out of the money i add, or added on top?",
        "does the rate fall as i spend more?",
        "is there a setup fee, a contract or a minimum?",
        "who owns the ad account and the data?",
      ] },
      { h: "how anryh labs does it" },
      { p: `a one-time ${usd(SETUP_FEE)} setup fee, then we keep a percentage of the ad funds you add: ${RATES_IN_WORDS}. ${HOW_IT_ADDS_UP} the percentage covers operations, creative generation and automation. the rest of what you add is your ad budget.` },
      { ul: [example(2000), example(10000), example(20000), example(30000)] },
      { h: "who it suits" },
      { p: "agents who would rather not pay a monthly retainer, and who want the creative and the daily work included. there is no monthly fee or contract." },
    ],
    faqs: [
      { q: "is the fee on top of my ad budget?", a: "no. we keep the percentage from the funds you add, and the remainder is your ad budget. the examples above show both numbers." },
    ],
    types: ["final-expense", "whole-life"],
  },
  {
    slug: "before-you-run-meta-ads-life-insurance",
    title: "what you need before you run meta ads as a life insurance agent",
    description: "the checklist before your first facebook or instagram ad: page, ad account, payment, licensing, a place for leads and a follow-up plan.",
    answer:
      "you need a facebook business page, a meta ad account with a way to pay, your license details for the states you will advertise in, a place for leads to go (a form or a booking page) and a plan to answer them within minutes. migz ai can handle the ads themselves.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "the checklist" },
      { ul: [
        "a facebook page for your business",
        "a meta ad account with a payment method or funds added",
        "your license and appointments for each state you will advertise in",
        "a lead form or booking page, with a plain consent line",
        "a way to be told about a lead right away",
        "a follow-up plan: when you call, what you email, when you stop",
      ] },
      { h: "what to decide" },
      { ul: [
        "which coverage to advertise first",
        "which states",
        "a budget you can keep up for at least a month",
        "what you will say on the call",
      ] },
      { h: "what you can hand off" },
      { p: "migz ai can build the campaign and the ads, run them every day and message you when a lead arrives. you still call, quote and close, and you stay responsible for your state's rules." },
    ],
    faqs: [
      { q: "do i need a website to run facebook ads?", a: "not for an instant form. a booking page helps if you want people to pick a call time, and anryh labs can provide one." },
    ],
    types: ["term-life", "coverage-beyond-work"],
  },
  {
    slug: "which-life-insurance-to-advertise",
    title: "whole life, term or final expense: which should you advertise first?",
    description: "pick the product you can close consistently, then test a second. how final expense, whole life, term, mortgage protection and iul suit different audiences.",
    answer:
      "advertise the product you most want to sell and can close consistently, then test a second. final expense and mortgage protection suit older and homeowner audiences and usually want fast follow-up. term suits young families. whole life and iul suit planners and need a longer conversation.",
    date: DATE,
    updated: DATE,
    body: [
      { h: "a quick guide" },
      { ul: [
        "final expense: older audiences who want funeral costs covered. phone-first, and follow-up matters.",
        "mortgage protection: homeowners who want the family to keep the home.",
        "term life: new parents and growing families who want affordable cover.",
        "whole life: planners who want lifelong cover that builds value.",
        "iul: mid-career earners who want protection and retirement planning in one conversation.",
        "income protection and policy reviews: families who depend on a paycheck, and people with an old policy.",
      ] },
      { h: "how to choose" },
      { ul: [
        "pick what you close most often, because lead cost matters less than close rate",
        "start with one main focus and add a second to test",
        "judge each by cost per reached lead and cost per policy",
      ] },
      { h: "in migz ai" },
      { p: "you choose up to three focus topics in order, and migz ai aims new ads at them, with the first as your main focus." },
    ],
    faqs: [
      { q: "can i advertise more than one type of life insurance?", a: "yes. migz ai lets you pick up to three focus topics, with the first as your main focus." },
    ],
    types: ["final-expense", "whole-life", "term-life", "mortgage-protection", "indexed-universal-life"],
  },
];

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);

/** Words in a post, for the read time. */
export function wordCount(post: Post) {
  const text = [post.answer, ...post.body.flatMap((b) => ("h" in b ? [b.h] : "p" in b ? [b.p] : b.ul))].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}
