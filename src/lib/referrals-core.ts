// Affiliates, the parts with no database: how much credit a deposit earns, how a refund or chargeback
// takes its share back, what a join request must contain, and the new agent's page address. Pure, so
// tests can check every number. The pipeline is referrals.ts.

/** A referrer earns this share of every deposit their referral makes, as ad credit. */
export const REFERRAL_RATE = 0.01;

/** Credit for one deposit: 1% of what they paid, rounded to the cent ($350 → $3.50). */
export const referralCreditCents = (depositCents: number) =>
  Number.isInteger(depositCents) && depositCents > 0 ? Math.round(depositCents * REFERRAL_RATE) : 0;

/**
 * What a refund (or chargeback) of `amountCents` out of a `depositCents` deposit takes back: the deposit
 * money itself, the matching share of the Anryh Labs fee goes back to the agent (they only lose the
 * ad money), and the matching share of the referrer's credit. A partial refund reverses its share.
 */
export function reversalShares(input: { depositCents: number; feeCents: number; creditCents: number; amountCents: number }) {
  const { depositCents, feeCents, creditCents } = input;
  const amount = Math.max(0, Math.min(input.amountCents, depositCents));
  if (!depositCents || !amount) return { refundCents: 0, feeBackCents: 0, creditBackCents: 0, adMoneyCents: 0 };
  const share = amount / depositCents;
  const feeBackCents = Math.round(Math.abs(feeCents) * share);
  const creditBackCents = Math.round(Math.abs(creditCents) * share);
  return { refundCents: amount, feeBackCents, creditBackCents, adMoneyCents: amount - feeBackCents };
}

const STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};
const BY_NAME = Object.fromEntries(Object.entries(STATES).map(([code, name]) => [name, code]));

/** "IL, fl / Texas" → ["IL", "FL", "TX"]. Unknown entries are dropped; codes and full names both work. */
export function parseStates(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;/\n]+/)) {
    const t = raw.trim().replace(/\.$/, "");
    if (!t) continue;
    const code = STATES[t.toUpperCase()] ? t.toUpperCase() : BY_NAME[t.toLowerCase().replace(/\s+/g, " ")];
    if (code) out.push(code);
    else for (const w of t.split(/\s+/)) if (STATES[w.toUpperCase()] && w.length === 2) out.push(w.toUpperCase()); // "IL FL TX"
  }
  return [...new Set(out)];
}

export type JoinInput = { fullName: string; email: string; phone: string; states: string; note: string };
export type JoinRequest = { fullName: string; email: string; phone: string | null; states: string[]; note: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Checks the join form. Errors are per field, in words for the person filling it in. */
export function validateJoin(input: Partial<JoinInput>): { ok: true; value: JoinRequest } | { ok: false; errors: Partial<Record<keyof JoinInput, string>> } {
  const fullName = clean(input.fullName, 120);
  const email = clean(input.email, 200).toLowerCase();
  const phone = clean(input.phone, 40);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  const states = parseStates(clean(input.states, 400));
  const errors: Partial<Record<keyof JoinInput, string>> = {};
  if (fullName.length < 2 || !/\p{L}/u.test(fullName)) errors.fullName = "Add your full name.";
  if (!EMAIL.test(email)) errors.email = "Add an email address you check.";
  if (phone && phone.replace(/\D/g, "").length < 10) errors.phone = "Add a 10-digit phone number, or leave it blank.";
  if (clean(input.states, 400) && !states.length) errors.states = "Use state codes or names, like IL, FL or Texas.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { fullName, email, phone: phone || null, states, note: note || null } };
}

// Top-level paths the site uses: a booking page can't take one of these as its address
const RESERVED_SLUGS = new Set([
  "api", "admin", "dashboard", "login", "signup", "about", "contact", "careers", "pairo", "privacy", "status", "write",
  "terms", "join", "auth", "companies", "our-story", "open-source-apps", "data-deletion",
]);

/** A booking page address from a name ("José O'Neil" → "jose-oneil"), made unique against `taken`. */
export function slugFor(fullName: string, taken: Set<string>): string {
  const base =
    fullName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "agent";
  const free = (s: string) => !taken.has(s) && !RESERVED_SLUGS.has(s);
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

/** Why a referral can't be linked, or null when it can. Same person = same email or same Stripe customer. */
export function selfReferral(
  a: { id: string; email: string; stripe_customer_id?: string | null },
  referrer: { id: string; email: string; stripe_customer_id?: string | null },
): string | null {
  if (a.id === referrer.id) return "An agent can't refer themselves.";
  if (a.email.trim().toLowerCase() === referrer.email.trim().toLowerCase()) return "That's the same email as the referrer.";
  if (a.stripe_customer_id && a.stripe_customer_id === referrer.stripe_customer_id) return "They pay with the same Stripe customer as the referrer.";
  return null;
}
