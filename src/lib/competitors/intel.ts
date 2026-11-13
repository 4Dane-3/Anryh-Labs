import "server-only";
import { getAdContext, latestRun } from "@/lib/competitors/store";

// What Migz carries into its reviews from the latest competitor research: the competitors' best offers and winning
// ads (to beat, never to copy word for word), and what the roofer can prove. "none yet" before the first run.

export async function competitorIntel(agentId: string) {
  const [run, ctx] = await Promise.all([latestRun(agentId, { done: true }), getAdContext(agentId)]);
  if (!run && !ctx) return "none yet";
  const offers = (run?.ads ?? []).filter((a) => a.offerRank).sort((a, b) => a.offerRank! - b.offerRank!).slice(0, 8);
  const winners = (run?.ads ?? []).filter((a) => a.top).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
  return {
    note: "From Migz's competitor research. Beat these offers and ads with what the roofer can prove; never copy their wording, never name a competitor, never claim what isn't in can_claim.",
    researched: run?.finished_at?.slice(0, 10) ?? null,
    competitor_offers_best_first: offers.map((a) => ({ type: a.offer!.type, offer: a.offer!.text, platform: a.platform })),
    competitor_winning_ads: winners.map((a) => ({ platform: a.platform, market: a.market, ad: [a.headline, a.body ?? a.description].filter(Boolean).join(" | ").slice(0, 200), why_it_ranks: a.clue })),
    can_claim: ctx ? [...ctx.proof.offer, ...ctx.proof.promises, ...ctx.proof.numbers].map((p) => p.adForm || p.claim).slice(0, 25) : [],
    cannot_claim_yet: ctx?.proof.gap ?? null,
    never_say: ctx?.proof.never.slice(0, 15) ?? [],
    google_reviews: ctx?.reviews.rating ? `${ctx.reviews.rating} stars from ${ctx.reviews.count} reviews` : null,
    best_review_quotes: ctx?.reviews.quotes.slice(0, 4).map((q) => `"${q.text}" (${q.author})`) ?? [],
    headlines_that_beat_them: run?.drafts?.verdict.publishable ? run.drafts.kept.headlines : undefined,
  };
}
