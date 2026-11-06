import { HOW_IT_ADDS_UP, MIN_FUNDS, PRICING_SUMMARY, RATES_IN_WORDS, ROOFING_PRICING_SUMMARY, ROOFING_SETUP_FEE, SETUP_FEE, usd } from "@/lib/pricing";
import { INSURANCE_TYPES, type Faq } from "@/lib/seo/insurance-types";

// Questions answered on the home page and the pricing page (and in the structured data beside them).
// Each answer opens with the answer, in plain words, so it reads well alone.

export const HOME_FAQS: Faq[] = [
  {
    q: "what is anryh labs?",
    a: "anryh labs makes migz ai, an ai media buyer for roofing companies and independent life insurance agents. it runs your whole meta (facebook and instagram) ad campaign: it makes the ads, reads the results through the day and fixes what holds back booked roof inspections, leads and booked calls. it is invite only.",
  },
  {
    q: "what does migz ai do for a life insurance agent?",
    a: "it builds the campaign, makes image and video ads, sends people to an instant form or your booking page, tells you on slack when a lead comes in, and adjusts budget and ads every day. every change comes with a reason, and it can't cross the hard limits you set.",
  },
  {
    q: "what does migz ai do for a roofing company?",
    a: "it runs meta ads for free roof inspections to homeowners within the radius you pick around your service area. homeowners book a time on your booking page, which asks for the address, whether they own the home, the roof issue and the roof's age. you get an email for each inspection with a postcard and door hanger for that street, a reminder the morning of, and the booking can go straight to your crm. its ads never promise a free roof or to cover an insurance deductible. to start, roofing companies pay a $3,000 setup up front and need at least $2,000 in meta ad spend for the first month.",
  },
  {
    q: "which types of life insurance can it advertise?",
    a: `${INSURANCE_TYPES.map((t) => t.name).join(", ")}. you pick up to three as your focus, and migz ai aims new ads at them.`,
  },
  {
    q: "how much does it cost?",
    a: `roofing companies pay a $3,000 setup up front and need at least $2,000 in meta ad spend for the first month. life insurance agents: ${PRICING_SUMMARY}`,
  },
  {
    q: "is there a monthly fee or a contract?",
    a: `for life insurance agents, no monthly fee. you pay the one-time ${usd(SETUP_FEE)} setup fee, and after that we only keep a percentage of the ad funds you choose to add (minimum ${usd(MIN_FUNDS)}). you can stop adding funds whenever you want.`,
  },
  {
    q: "do you guarantee leads or sales?",
    a: "no. nobody can honestly promise sales, because results depend on your market, your offer and how fast you follow up. migz ai is built to raise your chances: it reads results every day, tests new ads, tells you the moment a lead arrives and can start follow-up emails when you tap tried to call.",
  },
  {
    q: "whose ad account is it, and who owns the leads?",
    a: "yours. the ads run in your own meta ad account, you can remove migz ai's access in your facebook settings at any time, and every lead lands in your dashboard and your slack.",
  },
  {
    q: "who is it for?",
    a: "roofing companies and independent life insurance agents in the us who want a steady flow of booked inspections or calls from facebook and instagram without managing the ads themselves. it is invite only: tell us your trade, your area and your budget and we'll reply.",
  },
];

export const PRICING_FAQS: Faq[] = [
  { q: "how much does anryh labs cost?", a: `roofing companies: ${ROOFING_PRICING_SUMMARY} life insurance agents: ${PRICING_SUMMARY}` },
  { q: "what does it cost a roofing company?", a: ROOFING_PRICING_SUMMARY },
  {
    q: "how is the percentage worked out?",
    a: `we keep ${RATES_IN_WORDS}. the fee is kept from each amount you add, and the remainder goes to your ad budget. ${HOW_IT_ADDS_UP}`,
  },
  {
    q: "what does the percentage cover?",
    a: "operations, creative generation and automation. that means the setup and daily monitoring of your campaign, the image and video ads migz ai makes (including what it costs to generate them), and migz ai running the campaign itself. there are no separate charges for any of those.",
  },
  {
    q: "what is not included?",
    a: "your licensing and carrier appointments, your state's advertising rules, and any promise of leads or sales. you also still need an active meta ad account.",
  },
  {
    q: "what is the setup fee for?",
    a: `${usd(SETUP_FEE)} once for life insurance agents (roofing companies: ${usd(ROOFING_SETUP_FEE)}, paid up front), at the start: connecting your meta ad account and page, building your first campaign, your instant form and booking page, and getting the first ads live.`,
  },
  {
    q: "can i stop at any time?",
    a: "yes. there is no monthly fee or contract. stop adding funds and the campaign winds down, and you can ask for your unused ad balance back by email, less anything already spent or owed.",
  },
];
