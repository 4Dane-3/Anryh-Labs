import { isTopic, TOPICS, MAX_FOCUS, type TopicKey } from "@/lib/migz/topics";
import { MIN_SPLIT_DAILY_CENTS, VIDEO_TIERS, type IntentLevel, type VideoTier } from "@/lib/ad-options";

// Starting a campaign: the agent answers a few questions and picks a daily budget. Migz picks the length,
// the ad funds it needs, the creative mix, and shows the range of results to expect. Pure (client-safe):
// the start flow, the start action, Migz's review and the tests all read the same numbers.

// ---------- The agent's answers ----------

export type Underwriting = "exam" | "simplified" | "both";
export type ContactWay = "phone" | "in_person" | "both";
export type CallTime = "weekday_days" | "weekday_evenings" | "weekends";
export type Language = "en" | "es";

export type CampaignAnswers = {
  products: TopicKey[];
  /** The ages they write, e.g. 50–85. Null: any adult. */
  ageMin: number | null;
  ageMax: number | null;
  /** The smallest monthly premium they'll write, in dollars. */
  minPremium: number | null;
  underwriting: Underwriting | null;
  /** Whether they take people with health issues (guaranteed issue). */
  healthIssuesOk: boolean | null;
  languages: Language[];
  contact: ContactWay | null;
  callTimes: CallTime[];
};

/** The four products most agents sell, asked first; the rest sit behind "More". */
export const MAIN_PRODUCTS: TopicKey[] = ["final_expense", "term_life", "retirement_iul", "mortgage_protection"];

export const AGE_PRESETS = [
  { min: 50, max: 85, label: "50–85", detail: "Final expense and seniors" },
  { min: 60, max: 85, label: "60–85", detail: "Seniors only" },
  { min: 25, max: 60, label: "25–60", detail: "Working families" },
  { min: 30, max: 65, label: "30–65", detail: "Homeowners and planners" },
] as const;
export const MIN_AGE = 18;
export const MAX_AGE = 90;

export const PREMIUM_CHOICES = [20, 30, 50, 75, 100] as const;

export const UNDERWRITING: Record<Underwriting, { title: string; detail: string }> = {
  simplified: { title: "No medical exam", detail: "Simplified issue: health questions, no exam." },
  exam: { title: "Medical exam", detail: "Fully underwritten, with an exam." },
  both: { title: "Both", detail: "Whichever fits the person." },
};

export const CONTACT: Record<ContactWay, string> = { phone: "By phone", in_person: "In person", both: "Phone or in person" };
export const CALL_TIMES: Record<CallTime, string> = { weekday_days: "Weekdays, 9–5", weekday_evenings: "Weekday evenings", weekends: "Weekends" };
export const LANGUAGES: Record<Language, string> = { en: "English", es: "Spanish" };

const int = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
const oneOf = <T extends string>(v: unknown, keys: readonly T[]): T | null => (keys.includes(v as T) ? (v as T) : null);
const someOf = <T extends string>(v: unknown, keys: readonly T[]): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => keys.includes(x as T)))] : []);

/** The answers, cleaned: anything unknown is dropped, ages are kept in order. Never trusts the client. */
export function cleanAnswers(raw: unknown): CampaignAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let ageMin = int(r.ageMin, MIN_AGE, MAX_AGE);
  let ageMax = int(r.ageMax, MIN_AGE, MAX_AGE);
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  const languages = someOf(r.languages, ["en", "es"] as const);
  return {
    products: Array.isArray(r.products) ? [...new Set(r.products.filter(isTopic))].slice(0, MAX_FOCUS) : [],
    ageMin,
    ageMax,
    minPremium: int(r.minPremium, 1, 10_000),
    underwriting: oneOf(r.underwriting, ["exam", "simplified", "both"] as const),
    healthIssuesOk: typeof r.healthIssuesOk === "boolean" ? r.healthIssuesOk : null,
    languages: languages.length ? languages : ["en"],
    contact: oneOf(r.contact, ["phone", "in_person", "both"] as const),
    callTimes: someOf(r.callTimes, ["weekday_days", "weekday_evenings", "weekends"] as const),
  };
}

/** "for people 50–85", the safest way to say the age on screen. Null when they write any adult. */
export function ageCallout(a: Pick<CampaignAnswers, "ageMin" | "ageMax">) {
  if (a.ageMin === null && a.ageMax === null) return null;
  if (a.ageMax === null || a.ageMax >= MAX_AGE) return `for people ${a.ageMin}+`;
  return `for people ${a.ageMin ?? MIN_AGE}–${a.ageMax}`;
}

/** Whether the agent's answers allow a "no medical exam" hook. */
export const offersNoExam = (a: Pick<CampaignAnswers, "underwriting">) => a.underwriting === "simplified" || a.underwriting === "both";

/** The states (and DC) an agent can be licensed in, by postal code. */
export const STATE_CODES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

// ---------- Length and money ----------

export const MIN_CAMPAIGN_DAYS = 7;
export const MIN_CAMPAIGN_DAILY_CENTS = 2000;
export const MAX_CAMPAIGN_DAILY_CENTS = 100_000;
export const DAILY_CHOICES = [3000, 5000, 7500, 10_000, 15_000, 20_000] as const;

/**
 * How long Migz runs a campaign at this daily budget. Smaller budgets run longer so Meta sees enough
 * results to learn from: under $75/day 21 days, under $150/day 14 days, 10 days above that. Never under 7.
 */
export function recommendedDays(dailyCents: number) {
  const days = dailyCents < 7500 ? 21 : dailyCents < 15_000 ? 14 : 10;
  return Math.max(MIN_CAMPAIGN_DAYS, days);
}

export function lengthReason(dailyCents: number, days = recommendedDays(dailyCents)) {
  const base = `Meta needs time and results to learn who books, and longer campaigns do better: the first week is mostly learning, the weeks after are where the cost per result comes down.`;
  if (days >= 21) return `${base} At ${usd(dailyCents)}/day it takes about 3 weeks to collect enough results, so Migz runs it ${days} days.`;
  if (days >= 14) return `${base} At ${usd(dailyCents)}/day, 2 weeks gives Meta a week to learn and a week to improve.`;
  return `${base} At ${usd(dailyCents)}/day results come in faster, so ${days} days is enough for a fair read. Running longer still helps.`;
}

/** Ad funds come in $500 steps, so the amount the agent sees is the real minimum for the campaign. */
export const FUNDS_STEP_CENTS = 50_000;
export const roundUpToFundsStep = (cents: number) => Math.max(FUNDS_STEP_CENTS, Math.ceil(cents / FUNDS_STEP_CENTS) * FUNDS_STEP_CENTS);

// ---------- Creative mix ----------

/** Every ad set gets at least this many videos, part of the campaign (charged at list on a paid tier). */
export const INCLUDED_VIDEOS = 2;
export const MAX_IMAGES = 10;
/** Videos past the included two cost 20% under the tier's list price. */
export const EXTRA_VIDEO_DISCOUNT = 0.2;
/**
 * Extra Standard (Kling) videos. NOT DECIDED: whether they cost anything is the owner's call; until then
 * they're free like the included two.
 */
export const EXTRA_STANDARD_VIDEO_CENTS = 0;

export type CreativeMix = { total: number; videos: number; images: number; extraVideos: number };

/**
 * What one ad set launches with, all at the start of the campaign (nothing is added partway: new ads
 * restart Meta's learning). About 8 under $75/day, 10–12 around $100/day, 15 from $200/day.
 */
export function creativeMix(adsetDailyCents: number): CreativeMix {
  const total = adsetDailyCents < 7500 ? 8 : adsetDailyCents < 12_500 ? 10 : adsetDailyCents < 20_000 ? 12 : 15;
  const images = Math.min(MAX_IMAGES, total - INCLUDED_VIDEOS);
  const videos = total - images;
  return { total, videos, images, extraVideos: Math.max(0, videos - INCLUDED_VIDEOS) };
}

/** The price of one video: the tier's list price for the included two, 20% under it for the rest. */
export function videoPriceFor(tier: VideoTier, nth: number) {
  const list = VIDEO_TIERS[tier].priceCents;
  if (nth < INCLUDED_VIDEOS) return list;
  return list ? Math.round(list * (1 - EXTRA_VIDEO_DISCOUNT)) : EXTRA_STANDARD_VIDEO_CENTS;
}

/** What one ad set's videos cost on this tier. */
export function mixVideoCents(tier: VideoTier, mix: CreativeMix) {
  let cents = 0;
  for (let i = 0; i < mix.videos; i++) cents += videoPriceFor(tier, i);
  return cents;
}

/** How the daily budget splits into ad sets: one booking-page set, plus an instant-form set on low–medium intent. */
export function adsetShares(intent: IntentLevel, dailyCents: number): { destination: "website" | "instant_form"; dailyCents: number }[] {
  if (intent === "low_medium" && dailyCents >= MIN_SPLIT_DAILY_CENTS) {
    const form = Math.floor(dailyCents / 2);
    return [
      { destination: "website", dailyCents: dailyCents - form },
      { destination: "instant_form", dailyCents: form },
    ];
  }
  return [{ destination: "website", dailyCents }];
}

/** Angles a campaign's creatives cover, so no two are near-copies. "No exam" only when it's true. */
export const ANGLES = {
  price: "Price: what coverage costs a month, in plain numbers (no 'lowest' or 'cheapest').",
  no_exam: "No medical exam: coverage with health questions only.",
  family: "Family: who it protects, real moments at home.",
  burial_costs: "Burial costs: what a funeral costs today, so the family isn't left with the bill.",
  age_callout: "Age callout: who it's for, as a range ('for people 50–85', 'if you're between 50 and 85').",
  testimonial: "Testimonial style: a client-like story in their own words (never a real client's name or a made-up result).",
} as const;
export type Angle = keyof typeof ANGLES;

export function anglesFor(a: Pick<CampaignAnswers, "underwriting" | "ageMin" | "ageMax">): Angle[] {
  return (Object.keys(ANGLES) as Angle[]).filter((k) => (k === "no_exam" ? offersNoExam(a) : k === "age_callout" ? a.ageMin !== null || a.ageMax !== null : true));
}

// ---------- Expected results ----------

type Range = { low: number; mid: number; high: number };

/** Typical US life insurance results on Meta, for agents without their own numbers yet. */
export const TYPICAL = {
  instant_form: { cost: { low: 1500, mid: 2500, high: 4000 } as Range, follow: "30–50% of form leads answer when you call" },
  website: { cost: { low: 6000, mid: 9000, high: 15_000 } as Range, follow: "50–70% of booked calls show up" },
};

const PRODUCT_COST: Partial<Record<TopicKey, number>> = { final_expense: 1, mortgage_protection: 1.2, retirement_iul: 1.3, term_life: 1.1, whole_life: 1.05 };

/** How the agent's answers move the typical cost per result, and why, in plain words. */
export function costAdjustments(a: CampaignAnswers, states: string[]) {
  const notes: { text: string; factor: number }[] = [];
  if (states.length > 0 && states.length <= 2) notes.push({ factor: 1.2, text: "Only 1–2 states is a small audience, so each result costs more." });
  if (a.ageMin !== null && a.ageMax !== null && a.ageMax - a.ageMin < 20) notes.push({ factor: 1.15, text: "A narrow age range makes each result cost more." });
  if (offersNoExam(a)) notes.push({ factor: 0.9, text: "No-exam coverage gets more people to respond." });
  if (a.healthIssuesOk) notes.push({ factor: 0.9, text: "Taking people with health issues widens who can say yes." });
  if (a.languages.includes("es")) notes.push({ factor: 0.85, text: "Spanish-language ads usually cost less per result." });
  const main = a.products[0];
  const p = main ? PRODUCT_COST[main] ?? 1.1 : 1;
  if (p > 1.1) notes.push({ factor: p, text: `${TOPICS[main!].label} leads cost more than final expense.` });
  return { factor: notes.reduce((f, n) => f * n.factor, 1), notes };
}

/** The agent's own cost per result, once they have 2 finished campaigns with enough results to trust. */
export type OwnNumbers = {
  costPerCallCents: number | null;
  costPerLeadCents: number | null;
  campaigns: number;
  /** Share of booked calls that showed up, and of form leads reached, from the agent's answers (null until 5). */
  showRate?: number | null;
  reachRate?: number | null;
};

export type ExpectedLine = {
  destination: "website" | "instant_form";
  unit: "booked call" | "form lead";
  dailyCents: number;
  cost: Range; // cents per result
  perWeek: Range;
  total: Range; // over the whole campaign
  follow: string;
  source: "typical" | "yours";
};

export function expectedResults(input: { answers: CampaignAnswers; states: string[]; intent: IntentLevel; dailyCents: number; days?: number; own?: OwnNumbers | null }) {
  const days = input.days ?? recommendedDays(input.dailyCents);
  const adj = costAdjustments(input.answers, input.states);
  // Costs: their own after 2 finished campaigns. Show-up and reach rates: their own as soon as they're known
  const own = input.own && input.own.campaigns >= 2 ? input.own : null;
  const rate = (r: number | null | undefined) => `${Math.round(r! * 100)}%`;
  const lines: ExpectedLine[] = adsetShares(input.intent, input.dailyCents).map(({ destination, dailyCents }) => {
    const mine = destination === "website" ? own?.costPerCallCents : own?.costPerLeadCents;
    const cost: Range = mine
      ? { low: Math.round(mine * 0.75), mid: mine, high: Math.round(mine * 1.4) }
      : scale(TYPICAL[destination].cost, adj.factor);
    const per = (cents: number, c: number) => (cents * 7) / c;
    return {
      destination,
      unit: destination === "website" ? "booked call" : "form lead",
      dailyCents,
      cost,
      perWeek: { low: Math.floor(per(dailyCents, cost.high)), mid: Math.round(per(dailyCents, cost.mid)), high: Math.ceil(per(dailyCents, cost.low)) },
      total: {
        low: Math.floor((dailyCents * days) / cost.high),
        mid: Math.round((dailyCents * days) / cost.mid),
        high: Math.ceil((dailyCents * days) / cost.low),
      },
      follow:
        destination === "website" && input.own?.showRate != null
          ? `${rate(input.own.showRate)} of your booked calls show up (from your answers)`
          : destination === "instant_form" && input.own?.reachRate != null
            ? `you reach ${rate(input.own.reachRate)} of your form leads (from your answers)`
            : TYPICAL[destination].follow,
      source: mine ? "yours" : "typical",
    };
  });
  return { days, lines, notes: own ? [] : adj.notes.map((n) => n.text) };
}

const scale = (r: Range, f: number): Range => ({ low: Math.round(r.low * f), mid: Math.round(r.mid * f), high: Math.round(r.high * f) });

// ---------- The whole plan for a daily budget ----------

export function campaignMoney(input: { dailyCents: number; intent: IntentLevel; tier: VideoTier }) {
  const days = recommendedDays(input.dailyCents);
  const adSpendCents = input.dailyCents * days;
  const sets = adsetShares(input.intent, input.dailyCents).map((s) => ({ ...s, mix: creativeMix(s.dailyCents) }));
  const videoCents = sets.reduce((sum, s) => sum + mixVideoCents(input.tier, s.mix), 0);
  return {
    days,
    adSpendCents,
    videoCents,
    neededCents: adSpendCents + videoCents,
    recommendedFundsCents: roundUpToFundsStep(adSpendCents + videoCents),
    sets,
  };
}

// ---------- Migz AI's plan for a campaign ----------

/** Results a week that give Meta enough to learn from. */
export const LEARNING_RESULTS_PER_WEEK = 10;

/**
 * The daily budget Migz recommends: enough for about 10 results a week at the expected cost (the agent's
 * own once they have it), rounded to $5, between $30 and $300.
 */
export function recommendedDaily(costPerResultCents: number) {
  const daily = Math.round((costPerResultCents * LEARNING_RESULTS_PER_WEEK) / 7 / 500) * 500;
  return Math.min(30_000, Math.max(3000, daily));
}

/** What Migz shows when a campaign starts (stored on the batch for the Brain page). */
export type CampaignPlan = {
  /** No finished campaign yet: it starts from typical numbers. */
  first: boolean;
  learned: { text: string; evidence: string }[];
  changes: string[];
  budget: { dailyCents: number; days: number; recommendedDailyCents: number; why: string };
  expected: ReturnType<typeof expectedResults>;
  createdAt: string;
};

function usd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
