import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ExtraTool } from "@/lib/migz/operator";
import { emit } from "@/lib/migz/events";
import { searchHistory } from "@/lib/migz/team/librarian";

// Read-only tools the operator can call mid-review: the auditor's findings, the librarian, and the
// market swipe file. None of them affect spend.

function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool {
  return {
    name,
    description,
    strict: false, // see MAX_STRICT_TOOLS in tools.ts
    input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export const auditAccountTool: ExtraTool = {
  def: tool("audit_account", "List the auditor's open findings for this account (tracking, landing page, pacing, disapprovals, learning, naming, funding), most urgent first.", {}),
  spend: () => false,
  step: "auditing",
  async run(_input, env) {
    const { data } = await supabaseAdmin
      .from("audit_findings")
      .select("check_name, subject, severity, summary, first_seen")
      .eq("agent_id", env.agent.id)
      .eq("status", "open")
      .order("severity", { ascending: true });
    return { content: data?.length ? JSON.stringify(data) : "No open findings." };
  },
};

export const searchHistoryTool: ExtraTool = {
  def: tool("search_history", "Search this agent's own history (past actions, experiments, learnings, creatives) for precedent before repeating an idea. Returns a few dated bullets.", {
    query: { type: "string", description: "What to look for, e.g. 'final expense hook' or 'Reels placement'." },
  }),
  spend: () => false,
  step: "remembering",
  async run(input, env) {
    const query = String(input.query ?? "").slice(0, 200);
    if (!query) return { content: "Give a query.", isError: true };
    return { content: await searchHistory(env.agent.id, query, { runId: env.runId, budget: env.budget, createMessage: env.createMessage }) };
  },
};

export const researchMarketTool: ExtraTool = {
  def: tool("research_market", "Read the swipe file: external life-insurance ad examples (market research and ones the agent saved) with their angle, hook type, format and compliance risk. Inspiration only: never copy wording.", {}),
  spend: () => false,
  step: "researching",
  async run(_input, env) {
    const { data } = await supabaseAdmin
      .from("swipe_files")
      .select("advertiser, notes, traits, added_by, created_at")
      .or(`agent_id.is.null,agent_id.eq.${env.agent.id}`)
      .order("created_at", { ascending: false })
      .limit(10);
    await emit({ agentId: env.agent.id, runId: env.runId, step: "researching", tier: "code", summary: `Read ${data?.length ?? 0} swipe-file example(s)` });
    return { content: data?.length ? JSON.stringify(data) : "The swipe file is empty." };
  },
};

export const saveSwipeTool: ExtraTool = {
  def: tool("save_swipe", "Save an outside ad example or pattern worth remembering to this agent's swipe file (not their own ads).", {
    source_url: { type: ["string", "null"] },
    advertiser: { type: ["string", "null"] },
    notes: { type: "string", description: "What the ad does and why it's worth remembering." },
  }),
  spend: () => false,
  step: "remembering",
  async run(input, env) {
    const notes = String(input.notes ?? "").slice(0, 1000);
    if (!notes) return { content: "Notes are required.", isError: true };
    await supabaseAdmin.from("swipe_files").insert({
      agent_id: env.agent.id,
      source_url: typeof input.source_url === "string" ? input.source_url.slice(0, 500) : null,
      advertiser: typeof input.advertiser === "string" ? input.advertiser.slice(0, 120) : null,
      notes,
      added_by: "migz",
    });
    return { content: "Saved to the swipe file." };
  },
};

export const READ_TOOLS = [auditAccountTool, searchHistoryTool, researchMarketTool, saveSwipeTool];
