// Agents' own websites that host their booking page with our APIs (e.g. Foreign Financial's site for its
// agents). Booking, quotes and page analytics come from these origins cross-site, and a booking made there
// is reported to Meta with that page's URL.

export const PARTNER_SITES = ["foreignfinancial.org", "www.foreignfinancial.org"];

/** The page a booking or quote was made on, when it's one of the partner sites; otherwise null. */
export function partnerPageUrl(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && PARTNER_SITES.includes(url.hostname) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

// Agents whose booking page lives on their agency's own site: their ads link there, Migz checks that page,
// and their page here forwards to it (keeping the ad tags), so every ad visit lands on one page.
const AGENT_PAGES: Record<string, string> = {
  "miguel-cruz": "https://foreignfinancial.org/miguel-cruz",
};

/** The agent's booking page on a partner site, or null when it's their page here. */
export const partnerPage = (slug: string): string | null => AGENT_PAGES[slug] ?? null;

// Their photo on that site, for when their profile here has none (the confirmation email shows it)
const AGENT_PHOTOS: Record<string, string> = {
  "miguel-cruz": "https://foreignfinancial.org/team/miguel-cruz.jpg",
};

/** Where a booked prospect answers the optional questions: their agent's partner site when they have one. */
export function prepareUrl(slug: string, token: string, appUrl = process.env.APP_URL || "http://localhost:3000") {
  const partner = partnerPage(slug);
  return `${partner ?? `${appUrl.replace(/\/$/, "")}/${slug}`}/prepare?b=${token}`;
}

export const partnerPhoto = (slug: string): string | null => AGENT_PHOTOS[slug] ?? null;

// Who their emails to leads come from: an address on their agency's domain (verified in Resend), the agency's
// name, and the env var holding its postal address (CAN-SPAM needs one in every email; none, no email). The
// address is the agent's own name, not noreply@: Gmail reads noreply as automated mail and files it under
// Promotions. It needn't receive mail; replies go to the agent's real email (reply_to).
const AGENT_EMAIL_SENDER: Record<string, { from: string; business: string; postalEnv: string }> = {
  "miguel-cruz": { from: "miguel@foreignfinancial.org", business: "Foreign Financial", postalEnv: "FOREIGN_FINANCIAL_POSTAL_ADDRESS" },
};

/** The agent's lead-email sender: their agency's, else Anryh Labs' (BOOKING_EMAIL_FROM). Null when it can't be sent compliantly. */
export function leadEmailSender(slug: string) {
  const partner = AGENT_EMAIL_SENDER[slug];
  const from = partner?.from ?? process.env.BOOKING_EMAIL_FROM;
  const postalAddress = process.env[partner?.postalEnv ?? "LEAD_EMAIL_POSTAL_ADDRESS"]?.trim();
  return from && postalAddress ? { from, business: partner?.business ?? "Anryh Labs", postalAddress } : null;
}

/**
 * Where the agent's ads send people: their partner-site page, else their page on this app. A partner page
 * opens at its booking card (#book), so the calendar is the first thing a visitor sees instead of the intro
 * above it. (The ad's tracking tags are query parameters, which come before the #.)
 */
export function landingUrl(slug: string, appUrl = process.env.APP_URL || "http://localhost:3000") {
  const partner = partnerPage(slug);
  return partner ? `${partner}#book` : `${appUrl.replace(/\/$/, "")}/${slug}`;
}

/**
 * The link on the agent's ads: their own booking page when they chose to use it in Start here (no booking
 * tracking there: no booking events to Meta, no booking numbers for Migz), else landingUrl.
 */
export function adLinkFor(agent: { slug: string; booking_choice?: string | null; own_booking_url?: string | null }, appUrl?: string) {
  return agent.booking_choice === "own" && agent.own_booking_url ? agent.own_booking_url : landingUrl(agent.slug, appUrl);
}
