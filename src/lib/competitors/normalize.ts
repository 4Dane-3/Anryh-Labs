// Turns what the Apify scrapers return into our shapes. Pure, so the tests cover it.
//
// Actors (the same ones the steal-competitor-ads process uses):
//   compass/crawler-google-places        the top roofers on Google Maps in each market
//   solidcode/ads-transparency-scraper   every ad a domain runs on Google (Ads Transparency Center)
//   apify/facebook-ads-scraper           every active ad a Page runs on Facebook and Instagram, sorted by impressions
//   compass/google-maps-reviews-scraper  the roofer's own Google reviews

import type { Advertiser, CompAd, Market } from "@/lib/competitors/types";

export const ACTORS = {
  maps: "compass/crawler-google-places",
  google: "solidcode/ads-transparency-scraper",
  meta: "apify/facebook-ads-scraper",
  reviews: "compass/google-maps-reviews-scraper",
} as const;

/** The roofer's market, and Dublin as the benchmark: an English-speaking EU market where Meta shows real reach. */
export function marketsFor(serviceArea: string | null | undefined, state: string | null | undefined, benchmark = "Dublin, Ireland"): Market[] {
  const area = (serviceArea ?? "").trim();
  const local = area ? (state && !new RegExp(`\\b${state}\\b`).test(area) ? `${area}, ${state}` : area) : state ?? "";
  const out: Market[] = [];
  if (local) out.push({ key: "local", kind: "local", label: area.split(",")[0].trim() || local, query: `${local}, USA`, country: "US", region: "US" });
  if (benchmark) out.push({ key: "benchmark", kind: "benchmark", label: benchmark.split(",")[0].trim(), query: benchmark, country: "IE", region: "IE" });
  return out;
}

export const mapsInput = (m: Market, count = 50) => ({
  searchStringsArray: ["roofing contractor", "roofer"],
  locationQuery: m.query,
  maxCrawledPlacesPerSearch: count,
  language: "en",
  skipClosedPlaces: true,
  scrapePlaceDetailPage: false,
});

export const googleInput = (domain: string, m: Market) => ({ searchQuery: domain, region: m.region, maxResults: 40 });

/** A Maps listing name as people search for it: "Rock Roofing | Trusted Residential…" → "Rock Roofing". */
export const shortName = (name: string) => name.split(/\s[|–—-]\s|\s\|/)[0].replace(/\s+(llc|inc\.?|ltd\.?|co\.?)$/i, "").trim();

/**
 * What the Meta scraper is given for a competitor, never fetched by us: their Ad Library by Page id (sorted by
 * impressions, its hidden delivery order) when the Page link has one, else the Page link from their site as it is
 * (the scraper resolves it), else a keyword search for their name (whose results must match them by name or site).
 */
export function adLibraryUrl(m: Market, page: { pageUrl?: string; name?: string }) {
  const base = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${m.country}&media_type=all&sort_data[mode]=total_impressions&sort_data[direction]=desc`;
  if (page.pageUrl) {
    const id = page.pageUrl.match(/[?&]id=(\d+)/)?.[1] ?? page.pageUrl.match(/\/people\/[^/]+\/(\d{6,})/)?.[1] ?? page.pageUrl.match(/facebook\.com\/(\d{6,})/)?.[1];
    return id ? `${base}&search_type=page&view_all_page_id=${id}` : page.pageUrl;
  }
  return `${base}&search_type=keyword_unordered&q=${encodeURIComponent(shortName(page.name ?? ""))}`;
}

/** Whether a Meta ad's Page belongs to the competitor: by name (words other than the town and filler), or by a link to their site. */
export function pageMatches(adv: Pick<Advertiser, "name" | "domain">, pageName: string, links: (string | null | undefined)[], place = "") {
  const filler = new Set(["emergency", "local", "home", "improvements", "improvement", "and", "of", "pro", "pros", "group", "solutions", "ireland", "usa", ...normName(place).split(" ")]);
  const words = (s: string) => new Set(normName(s).split(" ").filter((w) => w && !filler.has(w)));
  const brand = words(shortName(adv.name));
  const page = words(pageName);
  const within = (x: Set<string>, y: Set<string>) => x.size > 0 && [...x].every((w) => y.has(w)) && [...x].some((w) => w.length >= 4);
  if (within(page, brand) || within(brand, page)) return true;
  const stem = (adv.domain ?? "").split(".")[0].replace(/-/g, "");
  if (stem.length >= 6 && normName(pageName).replace(/ /g, "").includes(stem.replace(/roofing|roofers?/g, "")) && stem.replace(/roofing|roofers?/g, "").length >= 4) return true;
  return !!adv.domain && links.some((l) => l && domainOf(l) === adv.domain);
}

export const metaInput = (urls: string[], perUrl = 30) => ({
  startUrls: urls.map((url) => ({ url })),
  resultsLimit: perUrl,
  isDetailsPerAd: true,
  activeStatus: "active",
  sorting: "total_impressions",
  includeAboutPage: false,
  enrichWithEcommerceData: false,
});

// ---------- Helpers ----------

const BLOCKED = /(^|\.)(facebook|fb|instagram|messenger|meta|whatsapp|l\.facebook)\.(com|me)$/i;
export const isBlockedHost = (host: string) => BLOCKED.test(host);

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") && !isBlockedHost(host) ? host : null;
  } catch {
    return null;
  }
}

/** A landing URL we may read: http(s), not Meta, without tracking junk. */
export function cleanUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname.replace(/^www\./, ""))) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|gbraid|wbraid|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function toDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export const daysBetween = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)) : null);
const text = (v: unknown): string | null => {
  const t = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" ? (v as { text: string }).text : null;
  const s = t?.replace(/\{\{[^}]+\}\}/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 1200) : null;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v.replace(/[, ]/g, ""))) ? Number(v.replace(/[, ]/g, "")) : null);

export const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(llc|inc|co|company|ltd|the|roofing|roofers?|contractors?|services?|exteriors?)\b/g, " ").replace(/\s+/g, " ").trim();

export function blankAd(fields: Partial<CompAd> & Pick<CompAd, "id" | "market" | "platform" | "advertiser">): CompAd {
  return {
    domain: null, format: null, headline: null, body: null, description: null, cta: null, displayUrl: null, landingUrl: null,
    media: { image: null, video: null, thumbnail: null }, startDate: null, lastSeen: null, daysRunning: null, active: null, copies: null,
    impressionsRank: null, impressionsRange: null, impressionsPerDay: null, euReach: null, reachPerDay: null, transparencyUrl: null,
    score: null, top: false, rank: null, clue: null, excluded: null, duplicateOf: null, offer: null, offerRank: null, offerWhy: null,
    ...fields,
  };
}

// ---------- Google Maps → advertisers ----------

export function advertisersFrom(items: Record<string, unknown>[], market: string, own: { name: string; domain: string | null }): Advertiser[] {
  const seen = new Set<string>();
  const ownName = normName(own.name);
  const out: Advertiser[] = [];
  for (const it of items) {
    const name = text(it.title) ?? text(it.name);
    if (!name) continue;
    const category = `${text(it.categoryName) ?? ""} ${(Array.isArray(it.categories) ? it.categories : []).join(" ")}`.toLowerCase();
    if (category && !/roof|contractor|construction|exterior|gutter|siding/.test(category)) continue;
    const website = typeof it.website === "string" ? it.website : null;
    const domain = domainOf(website);
    const key = domain ?? normName(name);
    if (!key || seen.has(key)) continue;
    if ((own.domain && domain === own.domain) || (ownName && normName(name) === ownName)) continue; // that's the roofer
    seen.add(key);
    out.push({
      market,
      name,
      domain,
      website,
      rating: num(it.totalScore),
      reviews: num(it.reviewsCount),
      phone: text(it.phone),
      address: text(it.address),
      placeUrl: typeof it.url === "string" ? it.url : null,
      facebookUrls: [],
      googleAds: 0,
      metaAds: 0,
    });
  }
  return out;
}

// ---------- Google Ads Transparency → ads ----------

/** Google's EU impression range for an ad, when it ran in Europe ({lowerBound, upperBound} in any of its shapes). */
function impressionsOf(it: Record<string, unknown>): [number, number] | null {
  const direct = it.impressions as { lowerBound?: unknown; upperBound?: unknown; min?: unknown; max?: unknown } | number | string | undefined;
  if (direct && typeof direct === "object") {
    const lo = num(direct.lowerBound ?? direct.min);
    const hi = num(direct.upperBound ?? direct.max);
    if (lo != null && hi != null) return [lo, hi];
  }
  const stats = (Array.isArray(it.regionStats) ? it.regionStats : Array.isArray(it.regions) ? it.regions : []) as Record<string, unknown>[];
  let lo = 0;
  let hi = 0;
  for (const r of stats) {
    const imp = (r.impressions ?? r.impressionRange) as { lowerBound?: unknown; upperBound?: unknown } | undefined;
    lo += num(imp?.lowerBound) ?? 0;
    hi += num(imp?.upperBound) ?? 0;
  }
  return hi > 0 ? [lo, hi] : null;
}

export function googleAdsFrom(items: Record<string, unknown>[], market: string, advertiser: Advertiser): CompAd[] {
  const out: CompAd[] = [];
  for (const it of items) {
    const cid = text(it.creativeId) ?? text(it.id);
    if (!cid) continue;
    const fmt = (text(it.adFormat) ?? text(it.format) ?? "").toLowerCase();
    const start = toDate(it.firstShown);
    const last = toDate(it.lastShown);
    const days = num(it.approxDaysShown) ?? daysBetween(start, last);
    const range = impressionsOf(it);
    out.push(
      blankAd({
        id: `google-${cid}`,
        market,
        platform: "google",
        advertiser: text(it.advertiserName) ?? advertiser.name,
        domain: advertiser.domain,
        format: fmt === "text" || fmt === "image" || fmt === "video" ? fmt : null,
        headline: text(it.headline) ?? text(it.title),
        description: text(it.description),
        displayUrl: text(it.displayUrl),
        landingUrl: cleanUrl(it.finalUrl ?? it.landingUrl),
        media: { image: typeof it.imageUrl === "string" ? it.imageUrl : null, video: typeof it.videoUrl === "string" ? it.videoUrl : null, thumbnail: typeof it.imageUrl === "string" ? it.imageUrl : null },
        startDate: start,
        lastSeen: last,
        daysRunning: days,
        impressionsRange: range,
        impressionsPerDay: range && days ? Math.round((range[0] + range[1]) / 2 / Math.max(1, days)) : null,
        transparencyUrl: typeof it.adUrl === "string" ? it.adUrl : null,
      }),
    );
  }
  return out;
}

// ---------- Meta Ad Library → ads ----------

function metaMedia(snap: Record<string, unknown>) {
  const vids = (snap.videos as Record<string, string>[] | undefined) ?? [];
  const imgs = (snap.images as Record<string, string>[] | undefined) ?? [];
  const cards = (snap.cards as Record<string, string>[] | undefined) ?? [];
  const c = cards[0] ?? {};
  const video = vids[0]?.videoHdUrl ?? vids[0]?.videoSdUrl ?? c.videoHdUrl ?? c.videoSdUrl ?? null;
  const image = imgs[0]?.originalImageUrl ?? imgs[0]?.resizedImageUrl ?? c.originalImageUrl ?? c.resizedImageUrl ?? null;
  const thumbnail = vids[0]?.videoPreviewImageUrl ?? c.videoPreviewImageUrl ?? imgs[0]?.resizedImageUrl ?? image;
  return { image, video, thumbnail };
}

function rangeOf(v: unknown): [number, number] | null {
  const s = text(v);
  if (!s) return null;
  const nums = [...s.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([KkMm])?/g)].map((m) => Number(m[1]) * (m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1));
  if (/^</.test(s.trim()) && nums[0]) return [0, nums[0]];
  return nums.length >= 2 ? [nums[0], nums[1]] : nums.length === 1 ? [nums[0], nums[0]] : null;
}

/**
 * Meta ads for one market. Items come in the impressions-sorted order per Page, so each ad's place in its Page's list
 * is Meta's hidden delivery rank. `byPage` matches a Page name back to the advertiser it belongs to.
 */
/** The scraper's items as single ads: one item per Ad Library URL with the ads in `results` (older versions: one ad per item). */
export const flattenMeta = (items: Record<string, unknown>[]) => items.flatMap((it) => (Array.isArray(it.results) ? (it.results as Record<string, unknown>[]) : [it]));

export function metaAdsFrom(rawItems: Record<string, unknown>[], market: string, byPage: (pageName: string, landing: string | null, inputUrl: string | null) => Advertiser | null, today = new Date().toISOString().slice(0, 10)): CompAd[] {
  const items = flattenMeta(rawItems);
  const out: CompAd[] = [];
  const order = new Map<string, number>();
  for (const it of items) {
    const id = text(it.adArchiveID) ?? text(it.adArchiveId);
    if (!id) continue;
    const snap = (it.snapshot as Record<string, unknown> | undefined) ?? {};
    const cards = (snap.cards as Record<string, unknown>[] | undefined) ?? [];
    const first = cards[0] ?? {};
    const pageName = text(it.pageName) ?? text(snap.pageName) ?? "";
    const landing = cleanUrl(snap.linkUrl) ?? cards.map((c) => cleanUrl(c.linkUrl)).find(Boolean) ?? null;
    const adv = byPage(pageName, landing, typeof it.inputUrl === "string" ? it.inputUrl : null);
    if (!adv) continue;
    const key = `${market}|${adv.domain ?? adv.name}`;
    const place = (order.get(key) ?? 0) + 1;
    order.set(key, place);
    const start = toDate(it.startDateFormatted ?? it.startDate);
    const end = toDate(it.endDateFormatted ?? it.endDate);
    const days = daysBetween(start, end && end < today ? end : today);
    const reach = num(((it.ad_details as Record<string, unknown> | undefined)?.aaa_info as Record<string, unknown> | undefined)?.eu_total_reach);
    const fmt = (text(snap.displayFormat) ?? "").toUpperCase();
    out.push(
      blankAd({
        id: `meta-${id}`,
        market,
        platform: "meta",
        advertiser: adv.name,
        domain: adv.domain,
        format: fmt === "VIDEO" || (snap.videos as unknown[] | undefined)?.length ? "video" : cards.length > 1 ? "carousel" : "image",
        headline: text(snap.title) ?? text(first.title),
        body: text(snap.body) ?? text(first.body),
        description: text(snap.linkDescription) ?? text(first.linkDescription),
        cta: text(snap.ctaText) ?? text(first.ctaText),
        displayUrl: text(snap.caption) ?? text(first.caption),
        landingUrl: landing,
        media: metaMedia(snap),
        startDate: start,
        lastSeen: end && end < today ? end : today,
        daysRunning: days,
        active: typeof it.isActive === "boolean" ? it.isActive : null,
        copies: num(it.collationCount),
        impressionsRank: place,
        impressionsRange: rangeOf((it.impressionsWithIndex as Record<string, unknown> | undefined)?.impressionsText),
        euReach: reach,
        reachPerDay: reach && days ? Math.round(reach / Math.max(1, days)) : null,
      }),
    );
  }
  return out;
}

/** Facebook Page links on a competitor's own homepage (only their site is read; the links are never visited). */
export function facebookLinks(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9.\-_/?=&]+)/g)) {
    const slug = m[1].split(/[?#"']/)[0].replace(/\/+$/, "");
    const head = slug.split("/")[0].toLowerCase();
    if (!head || ["sharer", "sharer.php", "share", "plugins", "tr", "dialog", "groups", "events", "watch", "login", "policies", "privacy", "help", "ads"].includes(head)) continue;
    if (head === "profile.php") {
      const id = m[1].match(/id=(\d+)/)?.[1];
      if (id) found.add(`https://www.facebook.com/profile.php?id=${id}`);
      continue;
    }
    if (head === "people") {
      const parts = slug.split("/");
      if (parts[2] && /^\d{6,}$/.test(parts[2])) found.add(`https://www.facebook.com/people/${parts[1]}/${parts[2]}`);
      continue;
    }
    found.add(`https://www.facebook.com/${slug.split("/").slice(0, head === "pages" ? 3 : 1).join("/")}`);
  }
  return [...found].slice(0, 2);
}
