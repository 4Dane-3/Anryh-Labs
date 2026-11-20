// The choices a roofer picks from in setup: the CRM they book in, what their ads offer, and the usual
// certifications, warranties and specials (they can always type their own). Client-safe and pure.

export const CRMS = ["JobNimbus", "AccuLynx", "Roofr", "ServiceTitan", "Leap", "RoofLink", "JobProgress", "Jobber", "HubSpot", "GoHighLevel", "Salesforce", "None yet"] as const;

export type LeadGoal = "inspection" | "quote";
export const LEAD_GOALS: { id: LeadGoal; title: string; detail: string }[] = [
  { id: "inspection", title: "Free roof inspection", detail: "You go up, check the roof and show them photos. Best when most homes need a look first." },
  { id: "quote", title: "Free quote", detail: "You measure and price the job. Best when they already know they want a new roof." },
];
export const isLeadGoal = (v: unknown): v is LeadGoal => v === "inspection" || v === "quote";

/** What the ads offer, in the words the copy uses. Inspection when they haven't chosen. */
export const leadOffer = (a: { lead_goal?: string | null } | null | undefined) =>
  a?.lead_goal === "quote" ? { short: "free quote", title: "Free quote", book: "Get a free quote" } : { short: "free roof inspection", title: "Free roof inspection", book: "Book a free inspection" };

/** Manufacturer certifications, grouped, top tier first. */
export const CERTIFICATIONS: { brand: string; tiers: string[] }[] = [
  { brand: "GAF", tiers: ["GAF Master Elite", "GAF Certified"] },
  { brand: "Owens Corning", tiers: ["Owens Corning Platinum Preferred", "Owens Corning Preferred Contractor"] },
  { brand: "CertainTeed", tiers: ["CertainTeed SELECT ShingleMaster", "CertainTeed ShingleMaster", "CertainTeed Credentialed"] },
  { brand: "Other", tiers: ["Malarkey Emerald Pro", "IKO ShieldPRO Plus+", "Atlas Pro+", "Tamko Pro Certified", "BBB A+ rated", "Licensed & insured"] },
];

export const WARRANTIES = [
  "Lifetime workmanship warranty",
  "25-year workmanship warranty",
  "10-year workmanship warranty",
  "50-year non-prorated manufacturer warranty",
  "GAF Golden Pledge warranty",
  "Owens Corning Platinum Protection warranty",
  "CertainTeed SureStart PLUS warranty",
  "Lifetime limited shingle warranty",
];

export const SPECIALS = [
  "$500 off a full roof replacement",
  "$1,000 off a full roof replacement",
  "Free gutter guards with a new roof",
  "Free upgrade to architectural shingles",
  "Free gutter cleaning with any repair",
];
// Also common but left out: financing ($0 down, no payments for 12 months), which the roofing copy rules
// (verticals.ts) block, and military or senior discounts, which call out a personal attribute in Meta's
// Housing category.

// Hair transplant clinics: the same steps with their own choices. Nothing here may break Meta's health ad rules
// (verticals.ts CLINIC_BANNED): no financing, no promised or permanent results, no before-and-after.
export const CLINIC_CRMS = ["GoHighLevel", "HubSpot", "Salesforce", "Zoho CRM", "Nextech", "ModMed", "PatientNow", "Zenoti", "Aesthetic Record", "None yet"] as const;

export const CLINIC_CERTIFICATIONS: { brand: string; tiers: string[] }[] = [
  { brand: "Surgeon", tiers: ["Board-certified surgeon", "ABHRS Diplomate", "Fellow of the ISHRS", "ISHRS member"] },
  { brand: "Clinic", tiers: ["Licensed medical clinic", "BBB A+ rated", "Rated 4.9 on Google"] },
];

/** What a clinic includes (never a promised result, which health ads can't make). */
export const CLINIC_INCLUDED = [
  "Free follow-up visits for 12 months",
  "Aftercare kit included",
  "Same surgeon from consultation to procedure",
  "Free hair and scalp analysis",
];

export const CLINIC_SPECIALS = [
  "Free consultation with the surgeon",
  "Free hair and scalp analysis at your consultation",
  "$500 off a hair transplant this month",
  "$1,000 off a hair transplant this month",
  "Free PRP session with a hair transplant",
];

/** The setup choices for a business type: roofers get theirs, clinics theirs. */
export function setupOptionsFor(vertical: string | null | undefined) {
  if (vertical === "hair_clinic")
    return {
      crms: CLINIC_CRMS as readonly string[],
      specials: CLINIC_SPECIALS,
      certifications: CLINIC_CERTIFICATIONS,
      certLabel: "Credentials your surgeon and clinic actually hold",
      extras: CLINIC_INCLUDED,
      extrasLabel: "What's included, exactly as you offer it",
      license: false,
      sample: ["Hairlines ", "designed", " by our surgeon"] as const,
    };
  return {
    crms: CRMS as readonly string[],
    specials: SPECIALS,
    certifications: CERTIFICATIONS,
    certLabel: "Certifications you actually hold",
    extras: WARRANTIES,
    extrasLabel: "Warranties, exactly as you offer them",
    license: true,
    sample: ["Your roof, ", "inspected", " free"] as const,
  };
}
