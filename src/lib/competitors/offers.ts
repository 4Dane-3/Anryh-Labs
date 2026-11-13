import "server-only";
import { arr, ask, nullable, obj, str } from "@/lib/competitors/llm";
import type { CompAd, OfferType } from "@/lib/competitors/types";

// Reading the ads: Google's Transparency Center returns text ads as pictures, so a small vision model reads each one.
// Then every ad's real offer is pulled out (a price, money off, something free, a guarantee, a speed promise; a free
// quote, a free inspection, "call now" or a phone number is not an offer), and the offers are ranked like a harsh buyer.

const OFFER_TYPES: OfferType[] = ["price", "money off", "free", "guarantee", "speed"];

/** The words on a Google text ad's image: headline, description and display URL. */
export async function readAdImage(agentId: string | null, imageUrl: string) {
  return ask<{ headline: string | null; description: string | null; displayUrl: string | null }>({
    task: "ad_reader",
    tier: "haiku",
    agentId,
    maxTokens: 800,
    effort: "low",
    system: "This is a screenshot of a Google search ad. Copy its text exactly: the headline (the large blue line or lines), the description (the text under it, before any sitelinks), and the display URL (like example.com/roof-repair). Null for anything not there.",
    content: [
      { type: "image", source: { type: "url", url: imageUrl } },
      { type: "text", text: "Read the ad." },
    ],
    schema: obj({ headline: nullable(str), description: nullable(str), displayUrl: nullable(str) }),
  }).catch(() => null);
}

/** Each ad's real offer, or null. Mutates the ads. */
export async function readOffers(agentId: string | null, ads: CompAd[]) {
  const chunks: CompAd[][] = [];
  for (let i = 0; i < ads.length; i += 60) chunks.push(ads.slice(i, i + 60));
  const results = await Promise.all(
    chunks.map((chunk) =>
      ask<{ ads: { id: string; type: string | null; offer: string | null }[] }>({
        task: "competitors",
        tier: "sonnet",
        agentId,
        maxTokens: 8000,
        effort: "low",
        system: `For each roofing ad, pull out its real offer, if it has one. A real offer is one of: price (a stated price or price from), money off (dollars or percent off, a discount), free (something of value given free beyond a quote or inspection, e.g. free gutter guards, free upgrade), guarantee (a guarantee or warranty promise), speed (a time promise, e.g. "quote in 24 hours", "same-day repair"). NOT an offer: a free quote, a free estimate, a free inspection, "call now", a phone number, "family owned", years in business. Quote the offer briefly in the ad's words. Null when there is none.`,
        content: chunk.map((a) => `${a.id}: ${[a.headline, a.body, a.description].filter(Boolean).join(" | ").slice(0, 600)}`).join("\n"),
        schema: obj({ ads: arr(obj({ id: str, type: nullable({ type: "string", enum: OFFER_TYPES }), offer: nullable(str) })) }),
      }).catch(() => null),
    ),
  );
  const byId = new Map(results.flatMap((r) => r?.ads ?? []).map((r) => [r.id, r]));
  for (const a of ads) {
    const r = byId.get(a.id);
    a.offer = r?.type && r.offer && OFFER_TYPES.includes(r.type as OfferType) ? { type: r.type as OfferType, text: r.offer.slice(0, 200) } : null;
  }
}

/** Ranks the real offers best to worst, like a harsh buyer, whatever the ad's delivery. Mutates offerRank and offerWhy. */
export async function rankOffers(agentId: string | null, ads: CompAd[]) {
  const withOffer = ads.filter((a) => a.offer);
  if (!withOffer.length) return;
  const out = await ask<{ order: { id: string; why: string }[] }>({
    task: "competitors",
    tier: "sonnet",
    agentId,
    maxTokens: 8000,
    system: "You are a harsh homeowner who needs a roof. Rank these roofing offers from the one that would most make you book to the least. Specific dollar value and believable risk reversal beat vague ones. Equal offers stay adjacent. One short line why for each.",
    content: withOffer.map((a) => `${a.id} (${a.offer!.type}): ${a.offer!.text}`).join("\n"),
    schema: obj({ order: arr(obj({ id: str, why: str })) }),
  }).catch(() => null);
  const order = out?.order ?? [];
  order.forEach((o, i) => {
    const a = withOffer.find((x) => x.id === o.id);
    if (a) Object.assign(a, { offerRank: i + 1, offerWhy: o.why.slice(0, 200) });
  });
}
