// What kind of business an account is. Migz started with life insurance agents; roofing companies use the same
// engine to book free roof inspections. Everything that reads differently for a roofer asks here. Client-safe.

export type Vertical = "insurance" | "roofing";
export const VERTICALS: Vertical[] = ["insurance", "roofing"];
export const isVertical = (v: unknown): v is Vertical => v === "insurance" || v === "roofing";

type HasVertical = { vertical?: string | null } | null | undefined;
export const verticalOf = (a: HasVertical): Vertical => (a?.vertical === "roofing" ? "roofing" : "insurance");
export const isRoofer = (a: HasVertical) => verticalOf(a) === "roofing";

/** The words that change between the two. */
export const WORDS = {
  insurance: {
    booking: "booked call",
    bookings: "booked calls",
    Bookings: "Booked calls",
    meeting: "call",
    meetingTitle: "Free consultation",
    owner: "agent",
    business: "life insurance agent",
  },
  roofing: {
    booking: "booked inspection",
    bookings: "booked inspections",
    Bookings: "Booked inspections",
    meeting: "inspection",
    meetingTitle: "Free roof inspection",
    owner: "roofer",
    business: "roofing company",
  },
} as const;
export const words = (a: HasVertical) => WORDS[verticalOf(a)];

// ---------- Service area (roofers) ----------

export const RADIUS_CHOICES = [10, 15, 25, 40] as const;
export const DEFAULT_RADIUS_MILES = 15;
export const MIN_RADIUS_MILES = 5;
export const MAX_RADIUS_MILES = 50; // Meta's limit for a radius around an address

/** A roofer's ads reach people this many miles around their service area (clamped to Meta's limits). */
export function radiusMiles(a: { service_radius_miles?: number | null }) {
  const r = a.service_radius_miles ?? DEFAULT_RADIUS_MILES;
  return Math.min(MAX_RADIUS_MILES, Math.max(MIN_RADIUS_MILES, Math.round(r)));
}

/** Roofing ads target ages directly (no special ad category); homeowners skew 30+. Meta's top age is 65 (= 65+). */
export const ROOFING_DEFAULT_AGE_MIN = 30;
export function roofingAges(answers: { ageMin?: number | null; ageMax?: number | null } | null | undefined) {
  const min = Math.min(65, Math.max(18, answers?.ageMin ?? ROOFING_DEFAULT_AGE_MIN));
  const max = answers?.ageMax == null || answers.ageMax >= 65 ? 65 : Math.max(min, answers.ageMax);
  return { min, max };
}

/** "within 15 miles of Plano, TX": where a roofer's ads run, in plain words. */
export function areaLabel(a: { service_area?: string | null; service_radius_miles?: number | null }) {
  return a.service_area ? `within ${radiusMiles(a)} miles of ${a.service_area}` : "no service area set";
}

/** Whether a roofer's ads have somewhere to run. */
export const hasServiceArea = (a: { service_area?: string | null }) => !!a.service_area?.trim();

// ---------- Roofing ad rules ----------

/**
 * Claims roofing ads must never make. Each is a pattern Migz's copy is checked against, with why. Financing
 * talk can also put the ads under Meta's Financial Products & Services category, which removes age and
 * radius targeting, so it's out.
 */
export const ROOFING_BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bfree\s+(new\s+)?roof\b(?!\s*(inspections?|checks?|check-?ups?|assessments?|evaluations?|estimates?|reports?))|\b(new\s+)?roof\s+for\s+free\b/i, why: "Never promise a free roof: only the inspection is free." },
  { pattern: /\bdeductible\b/i, why: "Never mention covering, waiving or paying the insurance deductible (illegal in many states)." },
  { pattern: /\b(your|this)\s+roof\s+(is|has|was)\s+(damaged|leaking|failing|unsafe)|\byou\s+have\s+(storm|hail|wind)\s+damage\b/i, why: "Never tell the viewer their roof is damaged; offer to check it." },
  { pattern: /\bfinanc(e|ing|ed)\b|\b0%\s*(apr|interest)\b|\bmonthly\s+payments?\b|\bno\s+money\s+down\b|\bcredit\b/i, why: "No financing, payment or credit claims: they can put the ads under Meta's Financial category." },
  { pattern: /\binsurance\s+(will\s+)?(pay|cover)s?\b|\bwe\s+(deal|work)\s+with\s+your\s+insurance\s+(company\s+)?(so\s+)?you\s+(pay|don't)/i, why: "Never promise insurance will pay for the roof." },
];

/** The first rule a piece of roofing ad copy breaks, or null. */
export function roofingCopyProblem(text: string) {
  return ROOFING_BANNED.find((r) => r.pattern.test(text))?.why ?? null;
}
