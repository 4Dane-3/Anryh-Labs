import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { emit } from "@/lib/migz/events";
import { callModel, jsonOf, planTier, textOf, type Budget, type CreateMessage } from "@/lib/migz/router";

// The market scout: Haiku with web search researches what's working in life-insurance advertising,
// from public sources (insurer and marketing sites, ad roundups), and files examples in the shared
// swipe file as inspiration only. Meta's Ad Library API doesn't return US insurance ads and the
// Ad Library site may not be scraped, so agents can also paste examples into their own swipe file.
// Public information only, so the shared file (agent_id null) is fine across agents.

export const SCOUT_EVERY_DAYS = 7;

export type Traits = {
  angle: string;
  hook_type: string;
  opening_image: string;
  emotional_tone: string;
  setting: string;
  text_legibility: string;
  claims: string[];
  compliance_risk: "low" | "medium" | "high";
  format?: string;
  offer?: string;
};

export const TRAITS_SCHEMA = {
  type: "object",
  properties: {
    angle: { type: "string" },
    hook_type: { type: "string", description: "question, surprising fact, story, testimonial, problem/solution, ..." },
    opening_image: { type: "string" },
    emotional_tone: { type: "string" },
    setting: { type: "string" },
    text_legibility: { type: "string", description: "how readable on-screen text is on a phone, or 'no text'" },
    claims: { type: "array", items: { type: "string" } },
    compliance_risk: { type: "string", enum: ["low", "medium", "high"] },
    format: { type: "string" },
    offer: { type: "string" },
  },
  required: ["angle", "hook_type", "opening_image", "emotional_tone", "setting", "text_legibility", "claims", "compliance_risk", "format", "offer"],
  additionalProperties: false,
} as const;

const SCOUT_SYSTEM = `You are the market scout on Migz AI's ad team, which runs Meta ads for independent US life insurance agents. Research what is working in life-insurance advertising on Facebook and Instagram right now, using web search on public sources (insurer and agency marketing pages, ad-industry articles and roundups). Find up to 6 distinct, concrete ad examples or documented patterns. For each, record the angle, hook pattern, offer, format and any claims it makes, and judge its compliance risk against Meta's financial-products rules (no guarantees, no implied approval, no calling out age, health or other personal attributes). Never copy wording into new ads; this is inspiration only. Finish with only a JSON object inside <examples></examples> tags: {"examples":[{"source_url":string,"advertiser":string,"notes":string,"traits":{"angle":string,"hook_type":string,"opening_image":string,"emotional_tone":string,"setting":string,"text_legibility":string,"claims":[string],"compliance_risk":"low"|"medium"|"high","format":string,"offer":string}}]}`;

type Example = { source_url: string; advertiser: string; notes: string; traits: Traits };

export function parseExamples(text: string): Example[] {
  const m = text.match(/<examples>([\s\S]*?)<\/examples>/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]) as { examples?: Example[] };
    return (parsed.examples ?? []).filter((e) => e && typeof e.notes === "string" && e.traits).slice(0, 6);
  } catch {
    return [];
  }
}

/** Shared weekly research. Returns how many examples were filed (0 when not due or over budget). */
export async function runScout(opts: { agentId: string; runId: string; budget: Budget; createMessage: CreateMessage; force?: boolean }) {
  const { data: last } = await supabaseAdmin
    .from("swipe_files")
    .select("created_at")
    .is("agent_id", null)
    .eq("added_by", "scout")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const due = !last || Date.now() - new Date(last.created_at).getTime() > SCOUT_EVERY_DAYS * 86_400_000;
  if (!due && !opts.force) return 0;
  const plan = planTier("scout", opts.budget);
  if (!plan) {
    await emit({ agentId: opts.agentId, runId: opts.runId, step: "researching", tier: "code", summary: "Skipped market research: model budget is nearly used this month" });
    return 0;
  }

  const res = await callModel({
    task: "scout",
    tier: plan.tier,
    agentId: null, // shared work: not billed against one agent's ceiling
    runId: opts.runId,
    createMessage: opts.createMessage,
    params: {
      max_tokens: 6000,
      output_config: { effort: "low" },
      // Haiku 5.5 takes the basic web search tool; the dynamic-filtering version needs Sonnet/Opus
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      system: [{ type: "text", text: SCOUT_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "Research this week's life-insurance ad patterns and file the examples." }],
    },
  });
  const examples = parseExamples(textOf(res.message));
  if (examples.length) {
    await supabaseAdmin.from("swipe_files").insert(
      examples.map((e) => ({
        agent_id: null,
        source_url: e.source_url?.slice(0, 500) || null,
        advertiser: e.advertiser?.slice(0, 120) || null,
        notes: e.notes.slice(0, 1000),
        traits: e.traits,
        added_by: "scout",
      })),
    );
  }
  await emit({
    agentId: opts.agentId,
    runId: opts.runId,
    step: "researching",
    tier: "haiku",
    model: res.model,
    summary: examples.length ? `Filed ${examples.length} market example(s) to the swipe file` : "Market research found nothing new to file",
    evidence: { examples: examples.map((e) => ({ advertiser: e.advertiser, angle: e.traits.angle, hook_type: e.traits.hook_type })) },
    inputTokens: res.usage.input,
    outputTokens: res.usage.output,
  });
  return examples.length;
}

/** Traits for a swipe example an agent pasted (from its URL and notes; we don't fetch Ad Library pages). */
export async function traitSwipe(swipeId: string, opts: { agentId: string; runId: string | null; budget: Budget; createMessage: CreateMessage }) {
  const { data: swipe } = await supabaseAdmin.from("swipe_files").select("source_url, advertiser, notes").eq("id", swipeId).single();
  if (!swipe) return null;
  const plan = planTier("swipe_traits", opts.budget);
  if (!plan) return null;
  const res = await callModel({
    task: "swipe_traits",
    tier: plan.tier,
    agentId: opts.agentId,
    runId: opts.runId,
    createMessage: opts.createMessage,
    params: {
      max_tokens: 1500,
      output_config: { effort: "low", format: { type: "json_schema", schema: TRAITS_SCHEMA } },
      system: [{ type: "text", text: "Describe this life-insurance ad example as structured creative traits, using only what the description says. Use 'unknown' where it doesn't say.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(swipe) }],
    },
  });
  const traits = jsonOf<Traits>(res.message);
  if (traits) await supabaseAdmin.from("swipe_files").update({ traits }).eq("id", swipeId);
  return traits;
}
