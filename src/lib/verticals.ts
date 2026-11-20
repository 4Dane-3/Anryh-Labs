// What kind of business an account is. Migz started with life insurance agents. Roofing companies and hair
// transplant clinics are local businesses on the same engine (a service area, landing pages that ask for a quote or
// consultation, booking, Emma calling): isLocal() asks that. What only fits one trade asks isRoofer() or
// isClinic(). Staff pick the business type when they invite a client (admin), so clients never choose. Client-safe.

export type Vertical = "insurance" | "roofing" | "hair_clinic";
export const VERTICALS: Vertical[] = ["insurance", "roofing", "hair_clinic"];
export const isVertical = (v: unknown): v is Vertical => v === "insurance" || v === "roofing" || v === "hair_clinic";
/** What staff see when they pick one. */
export const VERTICAL_LABELS: Record<Vertical, string> = { roofing: "Roofing company", hair_clinic: "Hair transplant clinic", insurance: "Life insurance agent" };

type HasVertical = { vertical?: string | null } | null | undefined;
export const verticalOf = (a: HasVertical): Vertical => (isVertical(a?.vertical) ? a.vertical : "insurance");
/** A local business: roofing or a clinic (service area, landing pages, quotes, Emma, presenter videos). */
export const isLocalVertical = (v: string | null | undefined) => v === "roofing" || v === "hair_clinic";
export const isLocal = (a: HasVertical) => isLocalVertical(a?.vertical);
export const isRoofer = (a: HasVertical) => a?.vertical === "roofing";
export const isClinic = (a: HasVertical) => a?.vertical === "hair_clinic";

/** The words that change between them. */
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
  hair_clinic: {
    booking: "booked consultation",
    bookings: "booked consultations",
    Bookings: "Booked consultations",
    meeting: "consultation",
    meetingTitle: "Free consultation",
    owner: "clinic",
    business: "hair transplant clinic",
  },
} as const;
export const words = (a: HasVertical) => WORDS[verticalOf(a)];

// ---------- Service area (roofers) ----------

// Roofing is home repair, which Meta puts under the Housing special ad category: a radius of at least 15 miles,
// no ZIP targeting, and no age choice (every adult, 18 to 65+).
export const RADIUS_CHOICES = [15, 25, 40, 50] as const;
export const DEFAULT_RADIUS_MILES = 15;
export const MIN_RADIUS_MILES = 15; // Housing's smallest radius
export const MAX_RADIUS_MILES = 50; // Meta's limit for a radius around an address

/** A roofer's ads reach people this many miles around their service area (clamped to Meta's limits). */
export function radiusMiles(a: { service_radius_miles?: number | null }) {
  const r = a.service_radius_miles ?? DEFAULT_RADIUS_MILES;
  return Math.min(MAX_RADIUS_MILES, Math.max(MIN_RADIUS_MILES, Math.round(r)));
}

/** Housing ads can't target by age: a roofer's ads reach every adult in the radius. Meta's top age, 65, means 65+. */
export const ROOFING_AGES = { min: 18, max: 65 } as const;
export const roofingAges = () => ROOFING_AGES;

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
  { pattern: /\b(seniors?|retirees?|young\s+(families|couples))\b|\bover\s+(50|55|60|65)\b(?!\s*(years|roofs|homes|jobs|reviews|five-star))|\b(50|55|60|65)\s*\+|\b(50|55|60|65)\s+and\s+(over|up|older)\b/i, why: "Call out the town or the house, never the person's age or family: roofing ads run in Meta's Housing category." },
  { pattern: /\binsurance\s+(will\s+)?(pay|cover)s?\b|\bwe\s+(deal|work)\s+with\s+your\s+insurance\s+(company\s+)?(so\s+)?you\s+(pay|don't)/i, why: "Never promise insurance will pay for the roof." },
];

/** The first rule a piece of roofing ad copy breaks, or null. */
export function roofingCopyProblem(text: string) {
  return ROOFING_BANNED.find((r) => r.pattern.test(text))?.why ?? null;
}

// ---------- Hair transplant clinic ad rules ----------

/**
 * What a clinic's ads must never say, from Meta's personal attributes and health policies (cosmetic procedures:
 * adults 18+, no before-and-after, no negative self-perception, no promised results). Each is a pattern Migz's
 * copy is checked against, with why.
 */
export const CLINIC_BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\byour\s+(thinning|receding|balding|bald(\s+spot)?|hair\s*loss|hairline|scalp)\b|\b(are|r)\s+you\s+(going\s+)?(bald|balding|losing\s+(your\s+)?hair|thinning)\b|\byou('re|\s+are)\s+(bald|balding|losing\s+(your\s+)?hair|thinning)\b/i, why: "Never assert or imply the viewer's hair loss or appearance (Meta's personal attributes policy): talk about the clinic and the procedure." },
  { pattern: /\b(tired|embarrassed|ashamed|insecure|self-conscious|sick)\s+(of|about)\s+(your|being|looking)\b|\bhate\s+(your|how\s+you\s+look)\b/i, why: "Never make the viewer feel bad about how they look (Meta's health policy: no negative self-perception)." },
  { pattern: /\bbefore\s*(and|&|\/|-)\s*after\b/i, why: "No before-and-after images or comparisons in clinic ads." },
  { pattern: /\bguarantee(d|s)?\s+(results?|growth|density|success)\b|\bresults?\s+(are\s+)?guaranteed\b|\b100\s*%\s+(natural|success|guaranteed|results?)\b|\bpermanent(ly)?\s+(results?|solution|fix|cure)\b|\bcure(s|d)?\s+(baldness|hair\s*loss)\b|\blook\s+\d+\s+years?\s+younger\b/i, why: "Never promise or guarantee results in a health ad." },
  { pattern: /\bfinanc(e|ing|ed)\b|\b0%\s*(apr|interest)\b|\bmonthly\s+payments?\b|\bno\s+money\s+down\b|\bcredit\b/i, why: "No financing, payment or credit claims: they can put the ads under Meta's Financial category." },
  { pattern: /\b(teens?|teenagers?|under\s+18|high\s+school(ers)?)\b/i, why: "Cosmetic procedure ads are for adults 18 and over only." },
];

/** The first rule a piece of clinic ad copy breaks, or null. */
export function clinicCopyProblem(text: string) {
  return CLINIC_BANNED.find((r) => r.pattern.test(text))?.why ?? null;
}
