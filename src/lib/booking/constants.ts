// Shown next to the phone field and stored with every booking as proof of consent.
export const CONSENT_TEXT =
  "I agree to be contacted by phone, text, and email about my life insurance inquiry and this appointment. Message and data rates may apply. Consent is not a condition of purchase.";

// Shown on the quote form and stored with every quote request as proof of consent.
export const QUOTE_CONSENT_TEXT =
  "I agree to be contacted by phone and text about my life insurance quote. Message and data rates may apply. Consent is not a condition of purchase.";

// How the booking page shows "Get a free quote": folded under the calendar (default), open for visitors
// who came from an ad, or off. Migz can change it (set_quote_option) when the funnel says so.
export const QUOTE_MODES = ["folded", "open_for_ads", "off"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];

// "Get a free quote": what the visitor can pick. Kept short; the agent asks the rest on the call.
export const QUOTE_COVERAGE = ["Final expense", "Whole life", "Term life", "Not sure yet"] as const;
export const QUOTE_BEST_TIME = ["Morning", "Afternoon", "Evening"] as const;

export const INTAKE_HEADER =
  "Help the agent prepare to secure you a better deal by answering (optional)";
