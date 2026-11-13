import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { areaLabel } from "@/lib/verticals";
import { cleanRules, describeRules } from "@/lib/roofing/job-rules";
import { allMedia, type JobMedia } from "@/lib/roofing/job-media";
import { arr, ask, nullable, obj, str } from "@/lib/competitors/llm";
import { pickPages, readPage, type PageRead } from "@/lib/competitors/web";
import type { AdContext, ProofLine } from "@/lib/competitors/types";

// The roofer's ad context: what their business is and what their ads may claim, read from their own website (home
// page plus up to 10 pages: reviews, about, warranty, services, specials), their Google reviews, testimonials on the
// site, and their videos (embedded on the site, plus clips they uploaded in Ad Creative AI Context). Nothing goes
// under "can claim" without a source; a review count under 10 is held back.

export async function siteOf(agentId: string) {
  const { data } = await supabaseAdmin.from("agent_brand").select("website, deals, certifications, warranties, license").eq("agent_id", agentId).maybeSingle();
  return (data as { website: string | null; deals: string[]; certifications: string[]; warranties: string[]; license: string | null } | null) ?? null;
}

/** The home page and the pages on it that matter for proof. */
export async function readSite(website: string | null, max = 10): Promise<PageRead[]> {
  if (!website) return [];
  const home = await readPage(website);
  if (!home) return [];
  const rest = await Promise.all(pickPages(home.links, max).map((l) => readPage(l)));
  return [home, ...rest.filter((p): p is PageRead => !!p)];
}

type Review = { name?: string; text?: string; textTranslated?: string; stars?: number; publishedAtDate?: string };
type Place = { title?: string; totalScore?: number; reviewsCount?: number; url?: string };

const proofLine = obj({ claim: str, adForm: str, source: str });

export async function buildContext(agent: Agent, input: { pages: PageRead[]; place: Place | null; reviews: Review[] }): Promise<AdContext> {
  const brand = await siteOf(agent.id);
  const { data: presenter } = await supabaseAdmin.from("agent_presenters").select("job_media, job_photo_paths").eq("agent_id", agent.id).maybeSingle();
  const uploads = allMedia((presenter as { job_media?: JobMedia[] } | null)?.job_media, (presenter as { job_photo_paths?: string[] } | null)?.job_photo_paths).filter((m) => m.type === "video");
  const reviews = input.reviews.filter((r) => (r.text ?? r.textTranslated ?? "").trim().length > 20).slice(0, 40);
  const siteVideos = [...new Set(input.pages.flatMap((p) => p.videos))];

  const material = [
    `Company: ${agent.full_name}. Service area: ${areaLabel(agent)}. Offer in their ads: a free ${agent.lead_goal === "quote" ? "quote" : "roof inspection"}.`,
    `What they told us in setup (owner said it, tier A): special: ${brand?.deals?.join("; ") || "none"}; certifications: ${brand?.certifications?.join("; ") || "none"}; warranties: ${brand?.warranties?.join("; ") || "none"}; license: ${brand?.license || agent.company_license || "none"}; jobs they take: ${describeRules(cleanRules(agent.job_rules)).join("; ") || "everything"}.`,
    input.place ? `Google Business Profile: ${input.place.totalScore ?? "?"} stars from ${input.place.reviewsCount ?? "?"} reviews (${input.place.url ?? ""}).` : "No Google Business Profile found.",
    reviews.length ? `Google reviews (newest first):\n${reviews.map((r, i) => `${i + 1}. ${r.name ?? "Customer"}, ${r.stars ?? "?"} stars, ${r.publishedAtDate?.slice(0, 10) ?? ""}: ${(r.text ?? r.textTranslated ?? "").slice(0, 600)}`).join("\n")}` : "No reviews read.",
    ...input.pages.map((p) => `PAGE ${p.url}\nTitle: ${p.title ?? ""}\nH1: ${p.h1 ?? ""}\n${p.text.slice(0, 5000)}`),
  ].join("\n\n");

  const out = await ask<{
    name: string;
    pitch: string;
    services: string[];
    buyer: string;
    gap: string;
    offer: ProofLine[];
    promises: ProofLine[];
    numbers: ProofLine[];
    hold: ProofLine[];
    never: string[];
    testimonials: { author: string | null; text: string; source: string }[];
    quotes: { author: string; stars: number | null; text: string; date: string | null }[];
  }>({
    task: "competitors",
    tier: "sonnet",
    agentId: agent.id,
    maxTokens: 12000,
    system: `You build a roofing company's ad context: who they are and exactly what their ads may claim. Read only the material given. Never invent a number, review, award, year, price or result.

Write:
- name, pitch (two short lines: what they do, for whom, the headline offer), services (short list), buyer (one sentence: who searches for a roofer here, on a phone, sceptical, what burned them before).
- gap: what the ads can't claim yet, plainly (e.g. no years in business on file, no client results with numbers).
- offer, promises, numbers: "can claim" lines. One claim each, adForm is how an ad could say it in under 30 characters where possible, source names where it came from (setup, a page URL, Google reviews). Round numbers down (4.87 stars → 4.8). A review count under 10 never goes here.
- hold: true but too weak or out of scope (under 10 reviews, dated claims, results from a different service).
- never: phrases these ads must never say (superlatives, outcomes with no proof, credentials not held, a free roof, insurance paying, financing, covering a deductible).
- testimonials: customer quotes found on their site pages (not Google reviews), word for word, with the page as source. Empty if none.
- quotes: up to 6 of the strongest Google reviews for ads, word for word (trim to the best 1-2 sentences), with author, stars and date.`,
    content: material.slice(0, 120_000),
    schema: obj({
      name: str,
      pitch: str,
      services: arr(str),
      buyer: str,
      gap: str,
      offer: arr(proofLine),
      promises: arr(proofLine),
      numbers: arr(proofLine),
      hold: arr(proofLine),
      never: arr(str),
      testimonials: arr(obj({ author: nullable(str), text: str, source: str })),
      quotes: arr(obj({ author: str, stars: nullable({ type: "number" }), text: str, date: nullable(str) })),
    }),
  });

  return {
    business: { name: out?.name || agent.full_name, pitch: out?.pitch ?? "", services: out?.services ?? [], area: areaLabel(agent), buyer: out?.buyer ?? "A homeowner searching on a phone, sceptical of roofers.", site: brand?.website ?? null },
    proof: {
      gap: out?.gap ?? "Nothing read yet.",
      offer: out?.offer ?? [],
      promises: out?.promises ?? [],
      numbers: (out?.numbers ?? []).filter((n) => !(/review/i.test(n.claim) && (input.place?.reviewsCount ?? 0) < 10)),
      hold: out?.hold ?? [],
      never: out?.never ?? [],
    },
    reviews: { rating: input.place?.totalScore ?? null, count: input.place?.reviewsCount ?? null, placeUrl: input.place?.url ?? null, quotes: out?.quotes ?? [] },
    testimonials: out?.testimonials ?? [],
    videos: [...siteVideos.map((url) => ({ url, title: null, source: "your website" })), ...uploads.map((m) => ({ url: m.path, title: m.kind === "other" ? "Job clip" : m.kind, source: "your uploads" }))],
    pagesRead: input.pages.map((p) => p.url),
    builtAt: new Date().toISOString(),
  };
}
