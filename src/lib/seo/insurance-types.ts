import type { TopicKey } from "@/lib/migz/topics";

// One page per kind of coverage an agent can ask Migz AI to advertise (the same list as the focus picker in
// the dashboard). Written to answer the question an agent, or an AI assistant answering for one, would ask.

export type Faq = { q: string; a: string };

export type InsuranceType = {
  slug: string;
  topic: TopicKey;
  name: string;
  /** the h1 and search title */
  headline: string;
  /** one or two sentences that answer "can migz ai run ads for this?" */
  answer: string;
  buyers: string;
  ads: string[];
  migz: string[];
  rules: string;
  faqs: Faq[];
  posts: string[];
};

const GENERIC_RULE =
  "ads never tell the viewer their age, health or finances, never promise rates, returns or approval, and follow meta's insurance ad policies and your state's advertising rules. migz ai writes inside those limits, and you approve what runs.";

export const INSURANCE_TYPES: InsuranceType[] = [
  {
    slug: "final-expense",
    topic: "final_expense",
    name: "final expense",
    headline: "final expense insurance ads, run by ai",
    answer:
      "yes. migz ai runs meta (facebook and instagram) ads for final expense and burial insurance, sends people to an instant form or your booking page, and tells you on slack the moment a lead comes in.",
    buyers: "people roughly 50 to 85 who want funeral and end-of-life costs covered so their family isn't left with the bill.",
    ads: [
      "warm, dignified family scenes across generations, not scare tactics",
      "who it's for stated as a range (\"for people 50–85\"), never telling the viewer their age or health",
      "image and video versions, tested against each other",
    ],
    migz: [
      "builds an instant-form ad set and a booking-page ad set side by side, so you see which kind of lead you close",
      "starts follow-up emails when you tap tried to call, since many final expense leads need a second try",
      "learns which ads bring people you actually reach, once you mark your calls",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai run final expense ads?", a: "yes. final expense is one of the coverage types you can pick as your focus, and migz ai builds the ads, the lead form and the follow-up around it." },
      { q: "do final expense leads come from an instant form or a booking page?", a: "both are available. an instant form usually brings more leads at a lower cost per lead, and a booking page brings fewer people who have already picked a time. migz ai can run the two side by side." },
      { q: "who owns the leads?", a: "you do. the ads run in your own meta ad account, and every lead lands in your dashboard and your slack." },
    ],
    posts: ["final-expense-facebook-ads", "instant-forms-vs-booking-page-life-insurance"],
  },
  {
    slug: "whole-life",
    topic: "whole_life",
    name: "whole life",
    headline: "whole life insurance ads, run by ai",
    answer:
      "yes. migz ai runs meta ads for whole life and cash value coverage, aimed at people who want permanent protection, and it keeps the copy free of returns or guarantees.",
    buyers: "planners who want lifelong coverage that builds value, often in their 30s to 60s.",
    ads: [
      "calm, long-term imagery and planning conversations",
      "no returns, growth figures or guarantees in the copy",
      "short videos that explain the idea in plain words",
    ],
    migz: [
      "tests several angles (legacy, family, planning) and keeps the ones that bring people you can reach",
      "sends each lead to your phone as a slack message, so the first call happens while they're still thinking about it",
      "keeps spend inside the budget you add, and pauses ads that have spent a lot with no result",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai advertise whole life insurance?", a: "yes. whole life and cash value is one of the focus topics. migz ai writes ads about lifelong coverage and avoids returns, growth figures and guarantees." },
      { q: "can i advertise whole life and final expense together?", a: "yes. you can pick up to three focus topics in order, and migz ai aims new ads at them, with the first as your main focus." },
    ],
    posts: ["which-life-insurance-to-advertise", "ai-media-buyer-for-insurance-agents"],
  },
  {
    slug: "mortgage-protection",
    topic: "mortgage_protection",
    name: "mortgage protection",
    headline: "mortgage protection insurance ads, run by ai",
    answer:
      "yes. migz ai runs meta ads for mortgage protection that speak to homeowners about keeping the family in the home, and sends the leads straight to you.",
    buyers: "new and existing homeowners who want the mortgage paid off or covered if the paycheck stops.",
    ads: [
      "scenes at home: the front door, the kitchen, the kids' rooms",
      "a hook on who pays the mortgage if something happens, without telling the viewer they own a home",
      "images and short videos, tested against each other",
    ],
    migz: [
      "targets the states you're licensed in",
      "alerts you on slack the moment a lead comes in",
      "writes new ads as old ones wear out, so you don't have to brief a designer",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai run mortgage protection ads?", a: "yes. mortgage protection is one of the focus topics, with ads built around keeping the family in the home." },
      { q: "do the ads tell people they own a home?", a: "no. meta doesn't allow ads that assert or imply personal details about the viewer, so the copy speaks to the situation (keeping the family in the home) instead. migz ai watches which ads bring the people you want to talk to." },
    ],
    posts: ["mortgage-protection-facebook-ads", "follow-up-facebook-leads-insurance"],
  },
  {
    slug: "term-life",
    topic: "term_life",
    name: "term life",
    headline: "term life insurance ads for young families, run by ai",
    answer:
      "yes. migz ai runs meta ads for term life aimed at new parents and growing families, and manages the whole campaign from ad creative to lead alerts.",
    buyers: "new parents and families with kids at home who want affordable coverage while the kids grow up.",
    ads: [
      "everyday family scenes and the moment you realize someone depends on you",
      "affordable-coverage hooks without quoting rates",
      "images and video, refreshed as they tire",
    ],
    migz: [
      "keeps testing new ads against the current best ones",
      "reads the booking funnel, so a landing-page problem isn't blamed on the creative",
      "gives you a plain-language reason for every change it makes",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai advertise term life insurance?", a: "yes. term life for young families is one of the focus topics, with ads built around protecting a family while the kids are growing up." },
      { q: "will the ads show my rates?", a: "no. rates depend on the applicant, so the ads don't quote or promise them. the call is where you quote." },
    ],
    posts: ["which-life-insurance-to-advertise", "before-you-run-meta-ads-life-insurance"],
  },
  {
    slug: "indexed-universal-life",
    topic: "retirement_iul",
    name: "indexed universal life (iul)",
    headline: "iul and retirement planning ads, run by ai",
    answer:
      "yes. migz ai runs meta ads for iul and retirement planning that aim at planning conversations, with no promised returns, tax outcomes or guarantees.",
    buyers: "mid-career earners thinking about protection and retirement planning together.",
    ads: [
      "planning-focused hooks, not product-feature lists",
      "no promised returns, tax outcomes or guarantees",
      "longer videos for the explaining a booking page can't do",
    ],
    migz: [
      "sends people to a booking page, since iul leads usually need a real conversation",
      "tracks which ads lead to booked calls instead of only clicks",
      "holds every change to the limits you set",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai run iul ads?", a: "yes. iul and retirement planning is one of the focus topics. the ads open a planning conversation and avoid returns, tax claims and guarantees." },
      { q: "is the copy compliant?", a: "migz ai follows meta's policies and avoids the claims that most often get insurance ads rejected, but you are responsible for your state's rules and your carrier's guidelines, so review what runs." },
    ],
    posts: ["which-life-insurance-to-advertise", "instant-forms-vs-booking-page-life-insurance"],
  },
  {
    slug: "income-protection",
    topic: "income_protection",
    name: "income protection",
    headline: "income protection insurance ads, run by ai",
    answer:
      "yes. migz ai runs meta ads for income protection aimed at working parents and breadwinners, built around the question of how long the family could keep up with bills.",
    buyers: "working parents and breadwinners whose family relies on a paycheck.",
    ads: [
      "a hook on how long the family could keep up with bills if the income stopped",
      "relatable workday and home scenes",
      "short videos and images, tested against each other",
    ],
    migz: [
      "finds which hooks get clicks and which get calls",
      "pauses ads that spend without producing leads",
      "lets you see the reason behind every move",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai run income protection ads?", a: "yes. income protection is one of the focus topics, with ads aimed at the families that depend on a paycheck." },
    ],
    posts: ["which-life-insurance-to-advertise", "ai-media-buyer-for-insurance-agents"],
  },
  {
    slug: "policy-review",
    topic: "policy_review",
    name: "policy reviews",
    headline: "life insurance policy review ads, run by ai",
    answer:
      "yes. migz ai runs meta ads that invite people to have an existing policy checked, without promising savings or lower rates.",
    buyers: "people who bought coverage years ago and never looked at it again.",
    ads: [
      "a hook on taking a second look",
      "no promised savings or lower rates",
      "plain images and short explainer videos",
    ],
    migz: [
      "books reviews straight into your calendar",
      "alerts you on slack when someone books",
      "learns which hooks bring people with policies worth reviewing",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai run policy review ads?", a: "yes. policy review is one of the focus topics. the ads invite a second look and never promise savings or lower rates." },
    ],
    posts: ["which-life-insurance-to-advertise", "exclusive-leads-vs-own-ads"],
  },
  {
    slug: "coverage-beyond-work",
    topic: "work_coverage_gap",
    name: "coverage beyond work (group life gaps)",
    headline: "ads for people who rely on work life insurance, run by ai",
    answer:
      "yes. migz ai runs meta ads built around the gap in group life insurance: work coverage ends when the job does.",
    buyers: "employees who count on a group policy from their employer.",
    ads: [
      "a hook that work life insurance ends when your job does",
      "office, commute and job-change moments",
      "short, clear videos and images",
    ],
    migz: [
      "tests the job-change angle against the family angle",
      "keeps the budget inside what you added",
      "tells you what it changed and why",
    ],
    rules: GENERIC_RULE,
    faqs: [
      { q: "can migz ai advertise coverage beyond work?", a: "yes. coverage beyond work is one of the focus topics, with ads about the gap that group life insurance leaves when someone changes jobs." },
    ],
    posts: ["which-life-insurance-to-advertise", "before-you-run-meta-ads-life-insurance"],
  },
];

export const typeBySlug = (slug: string) => INSURANCE_TYPES.find((t) => t.slug === slug);
