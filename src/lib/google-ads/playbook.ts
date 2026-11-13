// Migz's Google Ads playbook for roofing companies: the campaign it builds, the keywords and negatives it
// starts with, the limits on every change, and the instructions its daily review follows. Pure (no I/O), so
// the build, the guardrails and the tests share it.
//
// The shape follows what works for local home services on Google: one Search campaign on Google Search only
// (no Display, no search partners), people *in* the service area (not "interested in" it), phrase and exact
// keywords grouped by job, a long list of negatives from day one, responsive search ads written per group,
// call and callout assets, and bidding that starts on Maximize conversions and moves to a target cost per
// booked inspection once there's enough data.

import type { JobRules } from "@/lib/roofing/job-rules";

export type MatchType = "EXACT" | "PHRASE" | "BROAD";
export type SeedKeyword = { text: string; match: MatchType };
export type AdGroupPlan = { key: string; name: string; keywords: SeedKeyword[]; headlines: string[]; descriptions: string[]; path1: string; path2: string };

// ---------- Limits (Google's own, and ours) ----------

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;
export const PATH_MAX = 15;
export const MIN_HEADLINES = 5; // Google needs 3; 5+ gets a usable ad strength
export const MAX_HEADLINES = 15;
export const MIN_DESCRIPTIONS = 2;
export const MAX_DESCRIPTIONS = 4;
export const MAX_ADS_PER_GROUP = 3; // enabled responsive search ads per ad group
export const KEYWORD_MAX = 80;
export const MAX_KEYWORDS_PER_ACTION = 20;
export const MAX_NEGATIVES_PER_ACTION = 40;
export const MAX_ACTIONS_PER_REVIEW = 12;

/** The least a roofer can put into Google a month: below it a Search campaign gets too few clicks to learn. */
export const GOOGLE_MIN_MONTHLY_CENTS = 100_000;
/** What we recommend: roofing clicks often cost $15 to $50+, so this buys enough clicks to book jobs. */
export const GOOGLE_RECOMMENDED_MONTHLY_CENTS = 150_000;
export const GOOGLE_MAX_MONTHLY_CENTS = 5_000_000;
/** Google can spend up to 2x a day's budget on a busy day, but never more than 30.4 days' worth in a month. */
export const DAYS_PER_MONTH = 30.4;
export const dailyFromMonthly = (monthlyCents: number) => Math.floor(monthlyCents / DAYS_PER_MONTH);

// Budget: each change at most 25%, at least 3 days apart, never above the monthly cap the roofer set
export const BUDGET_MAX_STEP = 0.25;
export const BUDGET_MIN_DAYS_BETWEEN = 3;
// Bidding: Maximize conversions to start; a target cost per booked inspection once there's enough data
export const TARGET_CPA_MIN_CONVERSIONS = 15; // in the last 30 days; Google suggests 15 to 30
export const TARGET_CPA_FLOOR = 0.8; // a target never below 80% of the actual cost per conversion (it would strangle delivery)
export const BIDDING_MIN_DAYS_BETWEEN = 14; // each bidding change restarts Google's learning
export const LEARNING_DAYS = 7; // the first week after launch: only negatives and fixes
// Keywords: a keyword that spent this much with no conversion in 30 days is a loser
export const PAUSE_MIN_SPEND_X_TARGET = 2; // 2x the target cost per booked inspection…
export const PAUSE_MIN_SPEND_CENTS = 25_000; // …or $250 when there's no target yet
export const PAUSE_MIN_CLICKS = 15;
/** A rough cost per booked roofing inspection on Google, used until the account has its own. */
export const BENCHMARK_CPA_CENTS = { low: 10_000, high: 30_000 } as const;

// ---------- Conversions ----------

export const CONVERSIONS = {
  booked: { name: "Booked inspection (Migz)", category: "BOOK_APPOINTMENT", primary: true },
  call: { name: "Call from ad, 60s+ (Migz)", category: "PHONE_CALL_LEAD", primary: true },
  closed: { name: "Closed roofing job (Migz)", category: "PURCHASE", primary: false }, // reported; not bid on until there are enough
} as const;
export const CALL_MIN_SECONDS = 60;
/** The value sent with a closed job when the roofer hasn't told us their average ticket. */
export const DEFAULT_JOB_VALUE_DOLLARS = 12_000;

// ---------- Keywords ----------

const kw = (text: string, match: MatchType = "PHRASE"): SeedKeyword => ({ text, match });

/** Words that must never be blocked on their own: they're the whole business. */
export const CORE_WORDS = ["roof", "roofs", "roofing", "roofer", "roofers", "replacement", "replace", "repair", "repairs", "contractor", "contractors", "company", "companies", "near me", "local", "inspection", "estimate", "quote"];

/** Negative keywords every roofing account starts with (phrase match): job seekers, DIY, supplies, other "roofs". */
export const BASE_NEGATIVES = [
  "jobs", "job opening", "hiring", "career", "careers", "salary", "pay rate", "apprentice", "training", "school", "course", "class", "osha", "license exam",
  "diy", "do it yourself", "how to", "youtube", "video", "tutorial", "step by step",
  "home depot", "lowes", "lowe's", "menards", "supply", "supplies", "wholesale", "for sale", "materials only", "shingles for sale", "bundle of shingles", "roofing nails", "roof cement", "roof sealant", "flex seal",
  "car roof", "roof rack", "sunroof", "rv roof", "camper roof", "shed roof", "dog house", "gazebo", "carport kit", "roof of mouth", "mouth", "minecraft", "roblox", "lyrics", "movie", "netflix",
  "lawsuit", "sue", "complaint", "scam", "bbb complaint",
  "software", "app", "crm", "estimating software", "roofing calculator app", "marketing", "leads for roofers", "roofing leads",
];

/** Negatives that follow from the jobs the roofer takes (what they don't take, people never see their ad for). */
export function negativesFor(rules: JobRules | null): string[] {
  if (!rules) return [];
  const out: string[] = [];
  const takes = (t: string) => !rules.jobTypes.length || rules.jobTypes.includes(t as never);
  if (!takes("gutters")) out.push("gutter", "gutters", "gutter guards");
  if (!takes("siding")) out.push("siding");
  if (!takes("repair") && takes("replacement")) out.push("small repair", "patch", "fix a leak", "minor repair");
  if (rules.claims === "never") out.push("insurance claim", "hail damage claim", "storm damage claim", "public adjuster");
  if (rules.property === "residential") out.push("commercial", "industrial", "warehouse", "apartment complex", "hoa");
  if (rules.property === "commercial") out.push("house", "home", "residential");
  if (rules.roofTypes.length) {
    const names: Record<string, string[]> = { metal: ["metal roof", "metal roofing"], tile: ["tile roof", "clay tile"], flat: ["flat roof", "tpo", "epdm", "rubber roof"], cedar: ["cedar shake", "wood shake"], asphalt: ["asphalt shingle"] };
    for (const [kind, words] of Object.entries(names)) if (!rules.roofTypes.includes(kind as never)) out.push(...words);
  }
  for (const place of rules.excluded) if (/^[A-Za-z .'-]{2,40}$/.test(place)) out.push(place.toLowerCase());
  return out;
}

/** The Search campaign's ad groups, one per kind of job they take, each with keywords and ad text. */
export function adGroupPlans(input: { company: string; city: string | null; rules: JobRules | null; offer: "inspection" | "quote"; special: string | null; warranty: string | null; certification: string | null }): AdGroupPlan[] {
  const { rules, city } = input;
  const takes = (t: string) => !rules?.jobTypes.length || rules.jobTypes.includes(t as never);
  const inCity = (base: string) => (city ? [kw(`${base} ${city.toLowerCase()}`), kw(`${base} ${city.toLowerCase()}`, "EXACT")] : []);
  const offer = input.offer === "quote" ? "Free Quote" : "Free Inspection";
  const shared = sharedHeadlines(input, offer);
  const groups: AdGroupPlan[] = [];
  if (takes("replacement"))
    groups.push({
      key: "replacement",
      name: "Roof replacement",
      keywords: [kw("roof replacement"), kw("roof replacement near me", "EXACT"), kw("new roof"), kw("replace roof"), kw("roof replacement cost"), kw("reroof"), kw("new roof cost"), kw("roofing company"), kw("roofing contractor"), kw("roofers near me", "EXACT"), kw("roofing company near me", "EXACT"), ...inCity("roof replacement"), ...inCity("roofing company"), ...inCity("roofers")],
      headlines: [cut(`Roof Replacement${city ? ` ${city}` : ""}`), "New Roof, Done Right", "Local Roof Replacement", ...shared],
      descriptions: descriptions(input, "Full roof replacements by a local crew."),
      path1: "roof",
      path2: "replacement",
    });
  if (takes("repair"))
    groups.push({
      key: "repair",
      name: "Roof repair",
      keywords: [kw("roof repair"), kw("roof repair near me", "EXACT"), kw("roof leak repair"), kw("roof leaking"), kw("fix roof leak"), kw("missing shingles"), kw("emergency roof repair"), kw("roof leak"), ...inCity("roof repair")],
      headlines: [cut(`Roof Repair${city ? ` ${city}` : ""}`), "Roof Leak? We Can Help", "Fast Local Roof Repair", ...shared],
      descriptions: descriptions(input, "Leaks and missing shingles fixed by a local crew."),
      path1: "roof",
      path2: "repair",
    });
  if (rules?.claims !== "never" && (takes("replacement") || takes("repair")))
    groups.push({
      key: "storm",
      name: "Storm and hail damage",
      keywords: [kw("hail damage roof"), kw("storm damage roof"), kw("roof hail damage"), kw("wind damage roof"), kw("roof storm damage repair"), kw("roof insurance claim"), kw("hail damage roof inspection"), ...inCity("hail damage roof")],
      headlines: ["Storm Damage Roof Check", "Hail Damage Roof Inspection", "Local Storm Damage Roofers", ...shared],
      descriptions: descriptions(input, "We check your roof after the storm and show you what we find."),
      path1: "storm",
      path2: "damage",
    });
  if (takes("inspection") && !takes("replacement") && !takes("repair"))
    groups.push({
      key: "inspection",
      name: "Roof inspection",
      keywords: [kw("roof inspection"), kw("roof inspection near me", "EXACT"), kw("roof inspector"), kw("roof certification"), ...inCity("roof inspection")],
      headlines: ["Roof Inspection", "Local Roof Inspectors", ...shared],
      descriptions: descriptions(input, "A full roof inspection with photos of what we find."),
      path1: "roof",
      path2: "inspection",
    });
  if (takes("gutters") && rules?.jobTypes.length)
    groups.push({
      key: "gutters",
      name: "Gutters",
      keywords: [kw("gutter installation"), kw("new gutters"), kw("gutter replacement"), kw("seamless gutters"), kw("gutter guards"), ...inCity("gutter installation")],
      headlines: ["Seamless Gutter Installation", "New Gutters, Local Crew", ...shared],
      descriptions: descriptions(input, "Seamless gutters and guards installed by a local crew."),
      path1: "gutters",
      path2: "",
    });
  if (takes("siding") && rules?.jobTypes.length)
    groups.push({
      key: "siding",
      name: "Siding",
      keywords: [kw("siding replacement"), kw("siding installation"), kw("siding contractor"), kw("vinyl siding"), ...inCity("siding contractor")],
      headlines: ["Siding Replacement", "Local Siding Contractor", ...shared],
      descriptions: descriptions(input, "Siding replaced by a local crew."),
      path1: "siding",
      path2: "",
    });
  return groups.map((g) => ({ ...g, headlines: unique(g.headlines.filter((h) => h.length <= HEADLINE_MAX)).slice(0, MAX_HEADLINES), descriptions: unique(g.descriptions.filter((d) => d.length <= DESCRIPTION_MAX)).slice(0, MAX_DESCRIPTIONS) }));
}

function sharedHeadlines(input: { company: string; special: string | null; warranty: string | null; certification: string | null; city: string | null }, offer: string): string[] {
  return [
    cut(input.company),
    `Book a ${offer}`,
    `${offer} Today`,
    "Licensed & Insured Roofers",
    "Local, Family-Run Crew",
    "Book Online in 60 Seconds",
    input.special ? cut(input.special) : null,
    input.certification ? cut(`${input.certification} Roofer`) : null,
    input.warranty ? cut(input.warranty) : null,
    input.city ? cut(`Serving ${input.city}`) : null,
    "Photos of Everything We Find",
    "Honest Quotes, No Pressure",
  ].filter((h): h is string => !!h && h.length <= HEADLINE_MAX);
}

function descriptions(input: { company: string; offer: "inspection" | "quote"; special: string | null; warranty: string | null; city: string | null }, lead: string): string[] {
  const offer = input.offer === "quote" ? "free quote" : "free roof inspection";
  return [
    `${lead} Book your ${offer} online in under a minute.`,
    `${input.company}: licensed, insured and local${input.city ? ` to ${input.city}` : ""}. Pick a time that suits you.`,
    input.special ? `${input.special}. Ask about it at your ${offer}.` : `No pressure: we show you photos of what we find and give you an honest price.`,
    input.warranty ? `Backed by the ${input.warranty}. Book your ${offer} today.` : `Book your ${offer} today and get a clear, written price.`,
  ].map((d) => (d.length <= DESCRIPTION_MAX ? d : d.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, ".")));
}

/** Callouts under the ad (25 characters each). */
export function callouts(input: { offer: "inspection" | "quote"; warranty: string | null; certification: string | null; emergencies: boolean }): string[] {
  return [input.offer === "quote" ? "Free Quotes" : "Free Inspections", "Licensed & Insured", "Local Crew", "Book Online 24/7", input.emergencies ? "Emergency Leak Repair" : null, input.certification ? `${input.certification}`.slice(0, 25) : null, input.warranty ? "Strong Warranties" : null]
    .filter((c): c is string => !!c && c.length <= 25);
}

const cut = (s: string) => (s.length <= HEADLINE_MAX ? s : s.slice(0, HEADLINE_MAX).replace(/\s+\S*$/, ""));
const unique = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];

// ---------- The daily review's instructions ----------

export const REVIEW_INSTRUCTIONS = `You are Migz, running a roofing company's Google Ads account. Your one goal: the most booked inspections that turn into paying roofing jobs, for the money the roofer set, inside their service area. You get today's numbers as JSON and act through the tools; every call is checked and a rejected call tells you why.

How to run a roofing Search account well:

1. Search terms first, every review. Read search_terms_14d (what people actually typed). Block anything that isn't someone wanting roof work done on their own property in the area: job seekers, DIY and how-to, material and supply shopping, other kinds of "roof" (car, RV, shed, mouth), other businesses' names when the roofer isn't them, towns outside the service area, jobs the roofer doesn't take (jobs_they_take). Use add_negative_keywords with PHRASE match for a word or phrase that's always wrong, EXACT for one search that's wrong but whose words are fine elsewhere. Never block a term that converted, and never a core word on its own (roof, roofing, roofer, repair, replacement, near me). This is where most wasted money is, so be thorough, but don't block a real buyer's search just because it hasn't converted yet.

2. Grow what works. A search term with a conversion (or several clicks and a call) that isn't a keyword yet: add it with add_keywords (EXACT, to the ad group it came from). Prefer specific, high-intent searches: "roof replacement", "roof repair near me", "[city] roofing company", "hail damage roof inspection".

3. Cut what doesn't. A keyword that spent ${PAUSE_MIN_SPEND_X_TARGET}x the target cost per booked inspection (or $${PAUSE_MIN_SPEND_CENTS / 100} with no target yet) with no conversion in 30 days and at least ${PAUSE_MIN_CLICKS} clicks: pause_keyword. Low quality score (1 to 4) with spend usually means the ad or page doesn't match the search: write an ad that does before pausing.

4. Ads. Each ad group should have 2 to 3 enabled responsive search ads with 10 to 15 distinct headlines and 4 descriptions. Headlines: the service plus the city, the free inspection or quote offer, the current special, certifications and warranty, trust (licensed, insured, local, reviews if real), and a reason to book now. When an ad has had 1,500+ impressions and converts at less than half the rate of the best ad in its group, pause it and write a new one that borrows what the winner says. Never invent reviews, ratings, years in business, prices or awards that aren't in the facts. Never promise a free roof, insurance paying, financing, or covering a deductible.

5. Budget. The roofer's monthly cap is a hard limit (the system enforces it). Raise the daily budget only when the account books inspections at or under target AND search_budget_lost_impression_share is 10%+ (it's running out of money while working). Lower it when the cost per booked inspection is far over target for two weeks and search terms are already clean. Changes are at most 25%, 3+ days apart.

6. Bidding. Start on Maximize conversions. Once there are ${TARGET_CPA_MIN_CONVERSIONS}+ conversions in 30 days, set a target cost per conversion near the actual 30-day cost per conversion (never below 80% of it), then tighten slowly. Bidding changes restart Google's learning: at most every ${BIDDING_MIN_DAYS_BETWEEN} days, never during the first week.

7. Competitors. competitor_research (when present) lists the competitors' best offers and winning ads, and what the roofer can prove. When you write an ad, beat those with the roofer's own proof; never copy their words or name them, and never claim anything outside can_claim.

8. Patience. In the first ${LEARNING_DAYS} days after launch, only add negatives and fix problems. Small numbers lie: under ~15 clicks, a keyword or ad has no verdict yet. If nothing needs doing, call hold once with why.

Each call needs a short title (what you did) and a reason with the numbers that drove it. Keep it plain: the roofer reads these.`;
