import type { IntakeQuestion } from "@/lib/booking/questions";
import { ROOFING_ADDRESS_KEY, ROOFING_HOMEOWNER_KEY } from "@/lib/booking/questions";

// "Jobs we take": what a roofer accepts, checked on the server (never by the voice model's judgement) for
// Emma's speed-to-lead calls and the booking page. Pure, so the tests cover it.
//
// No rules saved (agents.job_rules is null) means everything gets through, so existing roofers behave exactly
// as before until they set some. A clear mismatch is "not_fit" (no booking, a polite message); an answer that is
// missing or "not sure" never blocks: the lead is "unsure", can book, and the roofer is told what to check.

export const JOB_TYPES = [
  { id: "replacement", label: "Full replacement" },
  { id: "repair", label: "Repairs" },
  { id: "inspection", label: "Inspection only" },
  { id: "gutters", label: "Gutters" },
  { id: "siding", label: "Siding" },
] as const;
export type JobType = (typeof JOB_TYPES)[number]["id"];

export const ROOF_TYPES = [
  { id: "asphalt", label: "Asphalt shingle" },
  { id: "metal", label: "Metal" },
  { id: "tile", label: "Tile" },
  { id: "flat", label: "Flat or low-slope" },
  { id: "cedar", label: "Cedar shake" },
] as const;
export type RoofKind = (typeof ROOF_TYPES)[number]["id"];

export type ClaimRule = "any" | "only" | "never"; // insurance-claim jobs: either, only those, or none
export type PropertyRule = "both" | "residential" | "commercial";

export type JobRules = {
  jobTypes: JobType[]; // empty = every kind
  minJobDollars: number | null; // smallest job they'll take
  claims: ClaimRule;
  minRoofAge: number | null; // years, applied to replacement leads
  roofTypes: RoofKind[]; // empty = every kind
  property: PropertyRule;
  homeownerOnly: boolean;
  allDecisionMakers: boolean; // everyone who decides must be at the inspection
  financing: boolean; // they offer financing
  emergencies: boolean; // they take same-day active-leak calls
  excluded: string[]; // 5-digit ZIPs and town names inside the radius they won't go to
  notes: string; // anything else
};

/** Lets everything through: what "no rules" means. */
export const OPEN_RULES: JobRules = {
  jobTypes: [],
  minJobDollars: null,
  claims: "any",
  minRoofAge: null,
  roofTypes: [],
  property: "both",
  homeownerOnly: false,
  allDecisionMakers: false,
  financing: false,
  emergencies: true,
  excluded: [],
  notes: "",
};

/** What the settings form starts with before a roofer has saved rules (homeowner-only is on by default). */
export const FORM_DEFAULTS: JobRules = { ...OPEN_RULES, homeownerOnly: true };

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((x) => x.id as T["id"]);

/** Rules from whatever was stored or submitted: unknown values dropped, numbers bounded. null = no rules. */
export function cleanRules(raw: unknown): JobRules | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => (allowed as readonly string[]).includes(x as string)))] : []);
  const num = (v: unknown, max: number) => {
    const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : null;
  };
  const excluded = (Array.isArray(r.excluded) ? r.excluded : typeof r.excluded === "string" ? r.excluded.split(/[\n,]/) : [])
    .map((x) => (typeof x === "string" ? x.trim().slice(0, 60) : ""))
    .filter(Boolean)
    .slice(0, 100);
  return {
    jobTypes: pick(r.jobTypes, ids(JOB_TYPES)),
    minJobDollars: num(r.minJobDollars, 1_000_000),
    claims: r.claims === "only" || r.claims === "never" ? r.claims : "any",
    minRoofAge: num(r.minRoofAge, 100),
    roofTypes: pick(r.roofTypes, ids(ROOF_TYPES)),
    property: r.property === "residential" || r.property === "commercial" ? r.property : "both",
    homeownerOnly: r.homeownerOnly === true,
    allDecisionMakers: r.allDecisionMakers === true,
    financing: r.financing === true,
    emergencies: r.emergencies !== false,
    excluded: [...new Set(excluded)],
    notes: typeof r.notes === "string" ? r.notes.trim().slice(0, 600) : "",
  };
}

/** Whether these rules can ever turn a lead away or change what's asked (financing, notes and the like don't). */
export function hasRules(rules: JobRules | null | undefined): rules is JobRules {
  if (!rules) return false;
  return (
    rules.jobTypes.length > 0 ||
    rules.minJobDollars != null ||
    rules.claims !== "any" ||
    rules.minRoofAge != null ||
    rules.roofTypes.length > 0 ||
    rules.property !== "both" ||
    rules.homeownerOnly ||
    rules.allDecisionMakers ||
    rules.excluded.length > 0
  );
}

const label = <T extends { id: string; label: string }>(list: readonly T[], id: string) => list.find((x) => x.id === id)?.label ?? id;

/** The rules in plain words, one line each: for the roofer's email and dashboard, and Emma's briefing. */
export function describeRules(rules: JobRules | null | undefined): string[] {
  if (!rules) return [];
  const out: string[] = [];
  if (rules.jobTypes.length) out.push(`Takes: ${rules.jobTypes.map((t) => label(JOB_TYPES, t).toLowerCase()).join(", ")}`);
  if (rules.minJobDollars != null) out.push(`Smallest job: $${rules.minJobDollars.toLocaleString("en-US")}`);
  if (rules.claims === "only") out.push("Insurance-claim jobs only");
  if (rules.claims === "never") out.push("No insurance-claim jobs");
  if (rules.minRoofAge != null) out.push(`Replacements: roof at least ${rules.minRoofAge} years old`);
  if (rules.roofTypes.length) out.push(`Roof types: ${rules.roofTypes.map((t) => label(ROOF_TYPES, t).toLowerCase()).join(", ")}`);
  if (rules.property !== "both") out.push(rules.property === "residential" ? "Residential only" : "Commercial only");
  if (rules.homeownerOnly) out.push("Homeowners only");
  if (rules.allDecisionMakers) out.push("Everyone who decides must be at the inspection");
  if (rules.financing) out.push("Offers financing");
  if (!rules.emergencies) out.push("No same-day leak emergencies");
  if (rules.excluded.length) out.push(`Won't go to: ${rules.excluded.join(", ")}`);
  if (rules.notes) out.push(`Also: ${rules.notes}`);
  return out;
}

// ---------- Reading answers ----------

/** What we know about a lead, every field optional ("" or null = not known). Free text is fine: it's read below. */
export type LeadFacts = {
  roofIssue?: string | null; // "A leak", "It's old, thinking about replacing"...
  jobType?: string | null; // a JobType id, when the caller already knows (Emma passes it)
  roofAge?: string | null; // "Under 10 years", "10–20 years", "15", "about 25 years old"
  roofType?: string | null; // "Shingle", "metal", "asphalt"...
  ownsHome?: string | null; // "Yes" / "No"
  property?: string | null; // "Residential" / "Commercial"
  insuranceClaim?: string | null; // "Not yet", "Yes, it's open", "No"
  decisionMakers?: string | null; // "Yes" / "No"
  address?: string | null;
  city?: string | null;
  activeLeak?: boolean | null; // water coming in right now
  jobDollars?: number | null; // a rough size, when the homeowner said one
};

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const unsure = (v: string) => !v || /^(not sure|unsure|don'?t know|dunno|no idea|unknown|maybe|\?)/i.test(v);
const yes = (v: string) => /^(yes|yeah|yep|y\b|true|i do|we do|sure|owner|own)/i.test(v);
const no = (v: string) => /^(no\b|nope|nah|n\b|false|not\b)/i.test(v) && !/^not sure/i.test(v);

/** A JobType from the issue ("A leak" is a repair, "thinking about replacing" a replacement), or null. */
export function jobTypeOf(f: Pick<LeadFacts, "roofIssue" | "jobType">): JobType | null {
  const direct = clean(f.jobType).toLowerCase();
  if ((ids(JOB_TYPES) as string[]).includes(direct)) return direct as JobType;
  const t = clean(f.roofIssue).toLowerCase();
  if (!t) return null;
  if (/siding/.test(t)) return "siding";
  if (/gutter/.test(t)) return "gutters";
  if (/replac|new roof|old|tear.?off|re-?roof/.test(t)) return "replacement";
  if (/just want it checked|inspect|check/.test(t)) return "inspection";
  if (/leak|storm|hail|wind|damage|missing|shingle|repair|patch|fix/.test(t)) return "repair";
  return null;
}

/** [lo, hi] years from "Under 10 years", "10–20 years", "Over 20 years", "15", "about 25"; null when not a number. */
export function roofAgeRange(v: string | null | undefined): [number, number] | null {
  const t = clean(v).toLowerCase().replace(/[–—]/g, "-");
  if (!t || unsure(t)) return null;
  const nums = (t.match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  if (/under|less than|<|newer/.test(t)) return [0, Math.max(0, nums[0] - 1)];
  if (/over|more than|older than|\+|>/.test(t)) return [nums[0], 100];
  if (nums.length >= 2 && /-|to/.test(t)) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  return [nums[0], nums[0]];
}

/** A RoofKind from "Shingle", "asphalt", "standing seam metal", "flat / TPO"..., or null when unknown. */
export function roofKindOf(v: string | null | undefined): RoofKind | null {
  const t = clean(v).toLowerCase();
  if (!t || unsure(t)) return null;
  if (/metal|standing|steel|aluminum|tin\b/.test(t)) return "metal";
  if (/tile|clay|concrete|slate/.test(t)) return "tile";
  if (/cedar|shake|wood/.test(t)) return "cedar";
  if (/flat|low.?slope|tpo|epdm|membrane|modified|built.?up/.test(t)) return "flat";
  if (/shingle|asphalt|composition|comp\b|3.?tab|architectural/.test(t)) return "asphalt";
  return null;
}

const zipOf = (f: LeadFacts) => /\b(\d{5})(?:-\d{4})?\b/.exec(`${f.address ?? ""} ${f.city ?? ""}`)?.[1] ?? null;

// ---------- The check ----------

export type FitVerdict = "fit" | "not_fit" | "unsure";
export type FitResult = {
  verdict: FitVerdict;
  /** Why it isn't a fit (roofer-facing, one line each). */
  reasons: string[];
  /** What to check at the inspection: an answer was missing, "not sure" or borderline. */
  flags: string[];
  /** An active leak the roofer takes same-day: offer the earliest slot and alert them urgently. */
  urgent: boolean;
  /** Not taking same-day leak calls: Emma doesn't promise same-day. */
  emergencyDeclined: boolean;
  /** The kind of job we read it as, when we could. */
  job: JobType | null;
};

/** Checks a lead against the rules. null / open rules always fit. */
export function evaluateLead(rules: JobRules | null | undefined, facts: LeadFacts): FitResult {
  const job = jobTypeOf(facts);
  const out: FitResult = { verdict: "fit", reasons: [], flags: [], urgent: false, emergencyDeclined: false, job };
  const leak = facts.activeLeak === true || (facts.activeLeak == null && /leak/i.test(clean(facts.roofIssue)) && /now|active|pour|drip|coming in/i.test(clean(facts.roofIssue)));
  if (leak) {
    if (rules && !rules.emergencies) out.emergencyDeclined = true;
    else out.urgent = true;
  }
  if (!rules) return out;

  const no_ = (reason: string) => out.reasons.push(reason);
  const flag = (f: string) => out.flags.push(f);

  // Where
  if (rules.excluded.length) {
    const zip = zipOf(facts);
    const place = ` ${clean(facts.address)} ${clean(facts.city)} `.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const hit = rules.excluded.find((x) => {
      const e = x.trim().toLowerCase();
      if (/^\d{5}$/.test(e)) return zip === e;
      return e.length > 1 && place.includes(` ${e.replace(/[^a-z0-9]+/g, " ").trim()} `);
    });
    if (hit) no_(`Outside where you work: ${hit}`);
  }

  // What
  if (rules.jobTypes.length) {
    if (!job) flag(`Couldn't tell what kind of job this is (you take: ${rules.jobTypes.map((t) => label(JOB_TYPES, t).toLowerCase()).join(", ")})`);
    else if (!rules.jobTypes.includes(job)) no_(`${label(JOB_TYPES, job)} isn't a job you take`);
  }
  if (rules.minJobDollars != null && facts.jobDollars != null && facts.jobDollars < rules.minJobDollars) no_(`Smaller than your $${rules.minJobDollars.toLocaleString("en-US")} minimum`);

  // The roof
  if (rules.minRoofAge != null && job === "replacement") {
    const age = roofAgeRange(facts.roofAge);
    if (!age) flag(`Roof age not known (you want ${rules.minRoofAge}+ years for a replacement)`);
    else if (age[1] < rules.minRoofAge) no_(`Roof is only ${age[0] === age[1] ? `${age[1]}` : `about ${age[1]} or under`} years old (you want ${rules.minRoofAge}+ for a replacement)`);
    else if (age[0] < rules.minRoofAge) flag(`Roof age is borderline (${clean(facts.roofAge)}); you want ${rules.minRoofAge}+ for a replacement`);
  }
  if (rules.roofTypes.length) {
    const kind = roofKindOf(facts.roofType);
    if (!kind) flag(`Roof type not known (you work on: ${rules.roofTypes.map((t) => label(ROOF_TYPES, t).toLowerCase()).join(", ")})`);
    else if (!rules.roofTypes.includes(kind)) no_(`${label(ROOF_TYPES, kind)} roof isn't one you work on`);
  }
  if (rules.property !== "both") {
    const p = clean(facts.property).toLowerCase();
    const kind = /commercial|business|building|warehouse|office|store/.test(p) ? "commercial" : /residential|home|house|residence/.test(p) ? "residential" : null;
    if (!kind) flag(`Not sure if it's residential or commercial (you take ${rules.property} only)`);
    else if (kind !== rules.property) no_(`${kind === "commercial" ? "Commercial" : "Residential"} property (you take ${rules.property} only)`);
  }

  // Who
  if (rules.homeownerOnly) {
    const own = clean(facts.ownsHome);
    if (unsure(own)) flag("Didn't confirm they own the home");
    else if (no(own) && !yes(own)) no_("Doesn't own the home (you take homeowners only)");
  }
  if (rules.claims !== "any") {
    const c = clean(facts.insuranceClaim);
    const filed = /\b(yes|open|filed|in progress|approved|adjuster)\b/i.test(c) && !/^(not yet|no\b)/i.test(c);
    const notFiled = /^(not yet|no\b|none|nope)/i.test(c);
    if (!filed && !notFiled) flag(`Didn't say whether there's an insurance claim (you take ${rules.claims === "only" ? "claim jobs only" : "no claim jobs"})`);
    else if (rules.claims === "never" && filed) no_("Has an insurance claim (you don't take claim jobs)");
    else if (rules.claims === "only" && notFiled) no_("No insurance claim (you take claim jobs only)");
  }
  if (rules.allDecisionMakers) {
    const d = clean(facts.decisionMakers);
    if (unsure(d)) flag("Didn't confirm everyone who decides will be at the inspection");
    else if (no(d) && !yes(d)) flag("Not everyone who decides can be at the inspection: confirm a time that works for all of them");
  }

  if (out.reasons.length) out.verdict = "not_fit";
  else if (out.flags.length) out.verdict = "unsure";
  return out;
}

/** The facts to check, from a booking's stored intake answers (keys of the roofer's form, plus property_type). */
export function factsFromAnswers(answers: Record<string, { value: string }> | null | undefined, extra: Partial<LeadFacts> = {}): LeadFacts {
  const a = (k: string) => answers?.[k]?.value?.trim() || null;
  return {
    roofIssue: a("roof_issue"),
    roofAge: a("roof_age"),
    roofType: a("roof_type"),
    ownsHome: a(ROOFING_HOMEOWNER_KEY),
    property: a(PROPERTY_KEY),
    insuranceClaim: a("insurance_claim"),
    decisionMakers: a(DECISION_MAKERS_KEY),
    address: a(ROOFING_ADDRESS_KEY),
    ...extra,
  };
}

/** The polite message to a homeowner we can't take on. Never names the exact rule. */
export function notFitMessage(company: string) {
  return `Thanks for reaching out. ${company} isn't the right fit for this particular job, so we don't want to waste your time. We'd suggest a roofer who handles this kind of work. We're sorry we can't help this time.`;
}

/** What the roofer sees for a lead: the verdict in a few words. */
export const fitLabel = (v: string | null | undefined) => (v === "not_fit" ? "Not a fit" : v === "unsure" ? "Check at inspection" : v === "fit" ? "Fits your rules" : null);

export type FitDetail = { reasons: string[]; flags: string[]; urgent: boolean; emergencyDeclined?: boolean; job: JobType | null };
export const fitDetail = (r: FitResult): FitDetail => ({ reasons: r.reasons, flags: r.flags, urgent: r.urgent, emergencyDeclined: r.emergencyDeclined, job: r.job });

// ---------- Booking-page questions ----------

export const PROPERTY_KEY = "property_type";
export const DECISION_MAKERS_KEY = "decision_makers";

const question = (key: string, step: number, sort: number, label: string, options: string[], extra: Partial<IntakeQuestion> = {}): IntakeQuestion => ({
  key, step, sort, label, kind: "choice", options, allow_other: false, placeholder: null, hidden_when_key: null, hidden_when_value: null, enabled: true, required: true, ...extra,
});

const RULE_QUESTIONS: Record<string, IntakeQuestion> = {
  [ROOFING_HOMEOWNER_KEY]: question(ROOFING_HOMEOWNER_KEY, 1, 1, "Do you own this home?", ["Yes", "No"]),
  [PROPERTY_KEY]: question(PROPERTY_KEY, 1, 2, "Is it a home or a business?", ["Residential", "Commercial"]),
  roof_age: question("roof_age", 2, 1, "About how old is the roof?", ["Under 10 years", "10–20 years", "Over 20 years", "Not sure"]),
  roof_type: question("roof_type", 2, 2, "What kind of roof is it?", ["Shingle", "Metal", "Tile", "Flat", "Cedar shake", "Not sure"], { allow_other: true }),
  insurance_claim: question("insurance_claim", 3, 0, "Have you filed an insurance claim for it?", ["Not yet", "Yes, it's open", "No"]),
  [DECISION_MAKERS_KEY]: question(DECISION_MAKERS_KEY, 4, -1, "Will everyone who decides on the roof be there for the inspection?", ["Yes", "No", "Not sure"]),
};

/** The question keys these rules need an answer to. */
export function neededKeys(rules: JobRules | null | undefined): string[] {
  if (!hasRules(rules)) return [];
  const keys: string[] = [];
  if (rules.jobTypes.length || rules.minRoofAge != null) keys.push("roof_issue");
  if (rules.homeownerOnly) keys.push(ROOFING_HOMEOWNER_KEY);
  if (rules.property !== "both") keys.push(PROPERTY_KEY);
  if (rules.minRoofAge != null) keys.push("roof_age");
  if (rules.roofTypes.length) keys.push("roof_type");
  if (rules.claims !== "any") keys.push("insurance_claim");
  if (rules.allDecisionMakers) keys.push(DECISION_MAKERS_KEY);
  return keys;
}

/**
 * The roofer's intake questions with the ones the rules need switched on and required (before the booking is
 * confirmed), and added when the roofer's own form lacks them. No rules: the questions are returned unchanged.
 */
export function withRuleQuestions(questions: IntakeQuestion[], rules: JobRules | null | undefined): IntakeQuestion[] {
  const keys = neededKeys(rules);
  if (!keys.length) return questions;
  const out = questions.map((q) => (keys.includes(q.key) ? { ...q, enabled: true, required: true } : q));
  for (const k of keys) if (!out.some((q) => q.key === k) && RULE_QUESTIONS[k]) out.push(RULE_QUESTIONS[k]);
  return out;
}

/** What Emma should ask (in this order), as short plain questions. Only what the rules need. */
export function callQuestions(rules: JobRules | null | undefined): { key: string; ask: string }[] {
  const ask: Record<string, string> = {
    roof_issue: "What's going on with the roof?",
    [ROOFING_HOMEOWNER_KEY]: "Do you own the home?",
    [PROPERTY_KEY]: "Is it a house or a business?",
    roof_age: "About how old is the roof?",
    roof_type: "What kind of roof is it: shingle, metal, tile, flat?",
    insurance_claim: "Have you filed an insurance claim on it?",
    [DECISION_MAKERS_KEY]: "Will everyone who decides on the roof be able to be at the inspection?",
  };
  return neededKeys(rules).map((key) => ({ key, ask: ask[key] }));
}

const FACT_FOR_KEY: Record<string, keyof LeadFacts> = {
  roof_issue: "roofIssue",
  [ROOFING_HOMEOWNER_KEY]: "ownsHome",
  [PROPERTY_KEY]: "property",
  roof_age: "roofAge",
  roof_type: "roofType",
  insurance_claim: "insuranceClaim",
  [DECISION_MAKERS_KEY]: "decisionMakers",
};

/** The questions the rules need that the facts don't answer yet, in the order to ask. Replacement-only ones are skipped for other jobs. */
export function unanswered(rules: JobRules | null | undefined, facts: LeadFacts) {
  const job = jobTypeOf(facts);
  return callQuestions(rules).filter(({ key }) => {
    if (key === "roof_age" && job && job !== "replacement") return false;
    return !clean(facts[FACT_FOR_KEY[key]] as string | null | undefined);
  });
}
