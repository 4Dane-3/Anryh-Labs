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

/**
 * Where the agent's ads send people: their partner-site page, else their page on this app. A partner page
 * opens at its booking card (#book), so the calendar is the first thing a visitor sees instead of the intro
 * above it. (The ad's tracking tags are query parameters, which come before the #.)
 */
export function landingUrl(slug: string, appUrl = process.env.APP_URL || "http://localhost:3000") {
  const partner = partnerPage(slug);
  return partner ? `${partner}#book` : `${appUrl.replace(/\/$/, "")}/${slug}`;
}
