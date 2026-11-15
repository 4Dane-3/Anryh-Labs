// A landing page for each Google ad group, on the roofer's own ad address (book.theirroofing.com/roof-replacement).
// The page's headline is the ad group's first headline and its subhead the first description, so the click lands
// on the promise it clicked. Pure: shared by the ads, the route and the dashboard.

import { adDomainUrl } from "@/lib/booking/ad-domain";
import { adLinkFor } from "@/lib/booking/sites";

export const LANDING_GROUPS = [
  { key: "replacement", path: "roof-replacement", name: "Roof replacement" },
  { key: "repair", path: "roof-repair", name: "Roof repair" },
  { key: "storm", path: "storm-damage", name: "Storm and hail damage" },
  { key: "inspection", path: "roof-inspection", name: "Roof inspection" },
  { key: "gutters", path: "gutters", name: "Gutters" },
  { key: "siding", path: "siding", name: "Siding" },
] as const;

export type LandingKey = (typeof LANDING_GROUPS)[number]["key"];

export const LANDING_PATHS: string[] = LANDING_GROUPS.map((g) => g.path);
export const groupByPath = (path: string) => LANDING_GROUPS.find((g) => g.path === path) ?? null;
export const groupByKey = (key: string) => LANDING_GROUPS.find((g) => g.key === key) ?? null;
/** The ad group's key from its name in Google Ads (Migz names them; a renamed group falls back to the booking page). */
export const groupKeyFromName = (name: string) => LANDING_GROUPS.find((g) => g.name.toLowerCase() === name.trim().toLowerCase())?.key ?? null;

type LinkAgent = Parameters<typeof adLinkFor>[0];

/**
 * Where an ad group's ads send people: its page on their ad address once that's live, else its page here.
 * A roofer who uses their own booking page keeps it, and an unknown group gets the booking page.
 */
export function landingPageUrl(agent: LinkAgent, key: string | null, appUrl = process.env.APP_URL || "http://localhost:3000") {
  const g = key ? groupByKey(key) : null;
  if (!g || (agent.booking_choice === "own" && agent.own_booking_url)) return adLinkFor(agent, appUrl);
  if (agent.ad_domain && agent.ad_domain_ok) return `${adDomainUrl(agent.ad_domain)}${g.path}`;
  return `${appUrl.replace(/\/$/, "")}/${agent.slug}/p/${g.path}`;
}

/** Their website's domain without www (martinezroofing.com), or null. */
export function rootDomainOf(website: string | null | undefined) {
  if (!website?.trim()) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
