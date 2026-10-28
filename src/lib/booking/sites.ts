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
