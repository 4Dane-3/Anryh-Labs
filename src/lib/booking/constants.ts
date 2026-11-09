// Shown next to the phone field and stored with every booking as proof of consent.
//
// LAWYER REVIEW: the "automated technology or an artificial or AI-generated voice" and recording wording below
// was added for the speed-to-lead voice agent (the FCC treats AI voices as "artificial" under the TCPA, so prior
// express written consent must cover them; Washington and other all-party-consent states need recording notice,
// which the agent also gives at the start of each call). Have counsel approve it, including whether to name the
// business and Migz AI in the text, before turning the voice agent on for any account.
const AI_CALLS =
  "including calls and texts made using automated technology or an artificial or AI-generated voice, at the number I provided. Calls may be recorded.";
export const CONSENT_TEXT =
  `I agree to be contacted by phone, text, and email about my life insurance inquiry and this appointment, ${AI_CALLS} Message and data rates may apply. Consent is not a condition of purchase.`;
export const ROOFING_CONSENT_TEXT =
  `I agree to be contacted by phone, text, and email about my roof inspection and this appointment, ${AI_CALLS} Message and data rates may apply. Consent is not a condition of purchase.`;
export const consentTextFor = (roof: boolean | undefined) => (roof ? ROOFING_CONSENT_TEXT : CONSENT_TEXT);

// Shown on the quote form and stored with every quote request as proof of consent (LAWYER REVIEW, as above).
export const QUOTE_CONSENT_TEXT =
  `I agree to be contacted by phone and text about my life insurance quote, ${AI_CALLS} Message and data rates may apply. Consent is not a condition of purchase.`;
export const ROOFING_QUOTE_CONSENT_TEXT =
  `I agree to be contacted by phone and text about a free roof inspection, ${AI_CALLS} Message and data rates may apply. Consent is not a condition of purchase.`;
export const quoteConsentTextFor = (roof: boolean | undefined) => (roof ? ROOFING_QUOTE_CONSENT_TEXT : QUOTE_CONSENT_TEXT);

// The wording before AI calls were added: instant forms made before then still show it, so their leads are
// never called by the voice agent (agents.meta_lead_form_ai_consent).
export const LEGACY_QUOTE_CONSENT_TEXT =
  "I agree to be contacted by phone and text about my life insurance quote. Message and data rates may apply. Consent is not a condition of purchase.";

// "Talk to us about a free inspection" on a roofer's page: what's wrong with the roof (optional)
// (the same words as the roof_issue intake question, so the voice agent's booking carries it straight over)
export const ROOF_ISSUES = ["A leak", "Storm or hail", "Missing or damaged shingles", "It's old, thinking about replacing", "Just want it checked"] as const;

// How the booking page shows "Get a free quote": folded under the calendar (default), open for visitors
// who came from an ad, or off. Migz can change it (set_quote_option) when the funnel says so.
export const QUOTE_MODES = ["folded", "open_for_ads", "off"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];

// "Get a free quote": what the visitor can pick. Kept short; the agent asks the rest on the call.
export const QUOTE_COVERAGE = ["Final expense", "Whole life", "Term life", "Not sure yet"] as const;
export const QUOTE_BEST_TIME = ["Morning", "Afternoon", "Evening"] as const;

export const INTAKE_HEADER =
  "Help the agent prepare to secure you a better deal by answering (optional)";

// Ticked on the referral page (/r/{token}) and stored with each referral. Referred people never get automated calls
// or texts: this covers sharing their details for a call by hand, not consent on their behalf (LAWYER REVIEW).
export const REFERRAL_PERMISSION_TEXT =
  "I have permission from each person above to share their name and contact details with this company so it can contact them about roofing.";
