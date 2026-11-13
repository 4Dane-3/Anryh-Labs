import "server-only";
import type { Agent } from "@/lib/booking/data";
import { arr, ask, int, obj, str } from "@/lib/competitors/llm";
import { applyRules, KEEP_DESCRIPTIONS, KEEP_HEADLINES, pickBest, proofText } from "@/lib/competitors/gates";
import { stripBrands, type Question } from "@/lib/competitors/scoring";
export { buildQuestions, stripBrands, tally, verdict, type Question } from "@/lib/competitors/scoring";
import type { AdContext, Angle, CompAd, Drafts, Headline, LandingPage, Matchup } from "@/lib/competitors/types";

// Ads that beat the competitors' winners. 150 headlines (and 40 descriptions) written from the roofer's proof and the
// best competitor offers, then three filters: the rules (code), a harsh buyer who has to pick ours over three of
// theirs in 4 of 5 blind runs (a separate model call that never knows which is ours), and variety. The 15 strongest
// headlines and 4 descriptions make one Google responsive search ad. Then the whole ad goes against each competitor
// winner, and a landing page against theirs: nothing is publishable unless the buyer is 9/10 sure ours is better.

export const HEADLINES_TO_WRITE = 150;
export const DESCRIPTIONS_TO_WRITE = 40;
const ANGLE_ENUM = ["offer", "speed", "price", "trust", "risk-reversal", "ask", "keyword"];

const adText = (a: CompAd) => [a.headline, a.body, a.description].filter(Boolean).join(" | ");

function brief(ctx: AdContext, winners: CompAd[], offers: CompAd[], agent: Agent) {
  const claim = (l: { claim: string; adForm: string }) => `- ${l.adForm || l.claim}`;
  return `ROOFER: ${ctx.business.name}, ${ctx.business.area}. Their ads offer a free ${agent.lead_goal === "quote" ? "quote" : "roof inspection"}.
BUYER: ${ctx.business.buyer}
CAN CLAIM (the only claims and numbers allowed):
${[...ctx.proof.offer, ...ctx.proof.promises, ...ctx.proof.numbers].map(claim).join("\n") || "- nothing beyond the free inspection"}
${ctx.reviews.rating && (ctx.reviews.count ?? 0) >= 10 ? `- ${ctx.reviews.rating} stars from ${ctx.reviews.count} Google reviews` : ""}
THE GAP (never claim): ${ctx.proof.gap}
NEVER SAY: ${ctx.proof.never.join("; ")}
COMPETITORS' WINNING ADS (beat these):
${winners.slice(0, 25).map((a) => `- [${a.platform}] ${adText(a).slice(0, 220)}`).join("\n")}
THEIR REAL OFFERS, BEST FIRST (steal the idea only where the roofer can honestly match it from CAN CLAIM):
${offers.slice(0, 15).map((a) => `- ${a.offer?.type}: ${a.offer?.text}`).join("\n") || "- none found"}`;
}

/** Writes a pool of lines. Returns them with ids and angles, unfiltered. */
export async function writeLines(agent: Agent, ctx: AdContext, winners: CompAd[], offers: CompAd[], kind: "headline" | "description", count: number, notes?: string): Promise<Headline[]> {
  const max = kind === "headline" ? 30 : 90;
  const out = await ask<{ lines: { text: string; angle: Angle }[] }>({
    task: "competitors",
    tier: "sonnet",
    agentId: agent.id,
    maxTokens: 16000,
    system: `You write Google responsive search ad ${kind}s for a roofing company that must beat the competitors' winning ads. Write exactly ${count} ${kind}s, each ${max} characters or fewer (count them), sentence case, each one reading alone in any order.
Spread them across six angles: offer, speed, price, trust, risk-reversal, ask (about equal), plus up to ${kind === "headline" ? 15 : 0} "keyword" lines (the search itself plus the city, e.g. "Roof replacement in Kent").
Every number and claim must come from CAN CLAIM. Never a competitor's name. Never a phone number, emoji, "!" in a headline, all caps, superlatives (best, #1, top-rated, cheapest, fastest), "risk-free", "limited time", a free roof, insurance paying, financing or a deductible. Win on what none of the competitors say: a claim they can't make, a fear they leave untouched, a specific promise from CAN CLAIM.`,
    content: `${brief(ctx, winners, offers, agent)}${notes ? `\n\nWHY THE BUYER PICKED THEIRS LAST ROUND (fix the line, not the wording):\n${notes}` : ""}`,
    schema: obj({ lines: arr(obj({ text: str, angle: { type: "string", enum: ANGLE_ENUM } })) }),
  });
  const prefix = kind === "headline" ? "h" : "d";
  return (out?.lines ?? []).slice(0, count + 10).map((l, i) => ({ id: `${prefix}${Date.now().toString(36)}${i}`, text: l.text.trim(), angle: ANGLE_ENUM.includes(l.angle) ? l.angle : "offer", stage: "spare", reason: null, wins: null, runs: null }));
}

/** Filter 1 over a fresh pool. */
export function rulesPass(pool: Headline[], kind: "headline" | "description", ctx: AdContext, competitorNames: string[]) {
  return applyRules(pool, kind, { proof: proofText(ctx), competitors: competitorNames });
}

// ---------- Filter 2: the harsh buyer ----------

/** The buyer answers one sheet of questions. Returns picks by question id (1-based option). */
export async function askBuyer(agentId: string, buyer: string, questions: Question[]) {
  const out = await ask<{ answers: { q: string; pick: number; why: string }[] }>({
    task: "buyer",
    tier: "sonnet",
    agentId,
    maxTokens: 12000,
    effort: "low",
    system: `You are this person: ${buyer} You need roof work. You're on your phone, you've already seen several roofers' ads, you trust none of them, and you give each option three seconds. For every question, pick the one line you would actually tap. Vague promises, hype and things every roofer says lose. Specific, believable, useful to you wins. Answer every question.`,
    content: questions.map((q) => `${q.q}\n${q.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}`).join("\n\n"),
    schema: obj({ answers: arr(obj({ q: str, pick: int, why: str })) }),
  });
  return new Map((out?.answers ?? []).map((a) => [a.q, a]));
}

// ---------- The pick, ours vs theirs, and the landing page ----------

export function finalPick(headlines: Headline[], descriptions: Headline[]) {
  const h = pickBest(headlines, KEEP_HEADLINES);
  const d = pickBest(descriptions, KEEP_DESCRIPTIONS);
  return { headlines: h.picked.map((x) => x.text), descriptions: d.picked.map((x) => x.text), varietyOk: h.varietyOk, angles: h.anglesCovered };
}

/** Our whole ad against one of theirs, blind (A/B at random). Our confidence 1-10 that a buyer taps ours. */
export async function versus(agentId: string, buyer: string, ours: { headlines: string[]; descriptions: string[] }, theirs: string, rand = Math.random) {
  const oursText = `${ours.headlines.slice(0, 3).join(" | ")}\n${ours.descriptions.slice(0, 2).join(" ")}`;
  const oursFirst = rand() < 0.5;
  const out = await ask<{ winner: "A" | "B"; certainty: number; why: string }>({
    task: "buyer",
    tier: "sonnet",
    agentId,
    maxTokens: 2000,
    system: `You are this person: ${buyer} You're a harsh judge, not a yes-man. Two roofing ads. Pick the one you would tap and say how certain you are, 1 to 10 (10 = no contest). One or two sentences why.`,
    content: `Ad A:\n${oursFirst ? oursText : theirs}\n\nAd B:\n${oursFirst ? theirs : oursText}`,
    schema: obj({ winner: { type: "string", enum: ["A", "B"] }, certainty: int, why: str }),
  });
  if (!out) return { confidence: 0, why: "The judge didn't answer." };
  const pickedOurs = (out.winner === "A") === oursFirst;
  const c = Math.max(1, Math.min(10, out.certainty));
  return { confidence: pickedOurs ? c : 11 - c, why: out.why };
}

export async function matchups(agentId: string, buyer: string, ours: { headlines: string[]; descriptions: string[] }, winners: CompAd[], names: string[]): Promise<Matchup[]> {
  const rivals = winners.slice(0, 6);
  return Promise.all(
    rivals.map(async (a) => {
      const theirs = stripBrands([a.headline, a.description ?? a.body].filter(Boolean).join("\n"), names);
      const v = await versus(agentId, buyer, ours, theirs);
      return { ours, theirs: { id: a.id, advertiser: a.advertiser, headline: a.headline, text: a.description ?? a.body }, confidence: v.confidence, why: v.why };
    }),
  );
}

type Landing = NonNullable<Drafts["landing"]>;

export async function writeLanding(agent: Agent, ctx: AdContext, winners: CompAd[], offers: CompAd[], ours: { headlines: string[]; descriptions: string[] }): Promise<Omit<Landing, "versus"> | null> {
  return ask<Omit<Landing, "versus">>({
    task: "competitors",
    tier: "sonnet",
    agentId: agent.id,
    maxTokens: 6000,
    system: `Write the landing page copy for a roofing company's Google ad, to beat the competitors' pages. It must match the ad's promise, lead with the offer, show proof only from CAN CLAIM and the reviews, answer the buyer's fears, and make booking the free ${agent.lead_goal === "quote" ? "quote" : "inspection"} the only action. Sections: what happens at the inspection, why us (proof), what it costs (only what's provable), reviews, the area served, a short FAQ. No superlatives, no claims beyond CAN CLAIM, no em-dashes.`,
    content: `${brief(ctx, winners, offers, agent)}\n\nTHE AD IT SITS BEHIND:\n${ours.headlines.join(" | ")}\n${ours.descriptions.join(" ")}\n\nREVIEWS TO QUOTE:\n${ctx.reviews.quotes.map((q) => `"${q.text}" (${q.author})`).join("\n") || "none"}`,
    schema: obj({ headline: str, subhead: str, offer: str, proof: arr(str), sections: arr(obj({ title: str, body: str })), cta: str }),
  });
}

export async function landingVersus(agentId: string, buyer: string, page: Omit<Landing, "versus">, theirs: LandingPage[], names: string[]) {
  const ours = `${page.headline}\n${page.subhead}\nOffer: ${page.offer}\n${page.proof.join(" · ")}\n${page.sections.map((s) => `${s.title}: ${s.body}`).join("\n")}\nButton: ${page.cta}`;
  return Promise.all(
    theirs.slice(0, 4).map(async (p) => {
      const v = await versus(agentId, buyer, { headlines: [ours], descriptions: [] }, stripBrands(`${p.title ?? ""}\n${p.h1 ?? ""}\n${p.text.slice(0, 2500)}`, names));
      return { url: p.url, confidence: v.confidence, why: v.why };
    }),
  );
}

