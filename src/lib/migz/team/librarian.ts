import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { emit } from "@/lib/migz/events";
import { callModel, planTier, textOf, type Budget, type CreateMessage } from "@/lib/migz/router";

// The librarian: greps this agent's own history (actions, experiments, learnings, creatives) for
// precedent, then Haiku boils the matches down to a few dated bullets so the operator doesn't have to
// read raw rows. Only ever this agent's data.

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "have", "what", "when", "about", "into", "than", "they", "were", "been", "ever", "tried", "test", "tests"]);

export function keywords(query: string) {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9$%-]+/).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 6);
}

type Hit = { kind: string; when: string; text: string };

export async function grepHistory(agentId: string, query: string): Promise<Hit[]> {
  const words = keywords(query);
  if (!words.length) return [];
  const or = (cols: string[]) => cols.flatMap((c) => words.map((w) => `${c}.ilike.%${w.replace(/[%,()]/g, "")}%`)).join(",");
  const [actions, learnings, experiments, creatives] = await Promise.all([
    supabaseAdmin.from("ad_actions").select("title, detail, status, created_at").eq("agent_id", agentId).or(or(["title", "detail"])).order("created_at", { ascending: false }).limit(15),
    supabaseAdmin.from("learnings").select("insight, confidence, created_at").eq("agent_id", agentId).or(or(["insight"])).order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("experiments").select("hypothesis, status, verdict, winner_label, result, created_at").eq("agent_id", agentId).or(or(["hypothesis"])).order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("creatives").select("hook, kind, status, traits, created_at").eq("agent_id", agentId).or(or(["hook"])).order("created_at", { ascending: false }).limit(10),
  ]);
  const when = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d, yyyy");
  return [
    ...(actions.data ?? []).map((a) => ({ kind: "action", when: when(a.created_at), text: `${a.title} (${a.status}): ${a.detail ?? ""}` })),
    ...(learnings.data ?? []).map((l) => ({ kind: "learning", when: when(l.created_at), text: `${l.insight} [${l.confidence} confidence]` })),
    ...(experiments.data ?? []).map((e) => ({ kind: "experiment", when: when(e.created_at), text: `${e.hypothesis} → ${e.status}${e.verdict ? `, ${e.verdict}${e.winner_label ? ` (${e.winner_label} won)` : ""}` : ""}` })),
    ...(creatives.data ?? []).map((c) => ({ kind: "creative", when: when(c.created_at), text: `${c.kind} "${c.hook ?? ""}" (${c.status})${c.traits ? ` traits: ${JSON.stringify(c.traits).slice(0, 200)}` : ""}` })),
  ];
}

const LIBRARIAN_SYSTEM = `You are the librarian on Migz AI's ad team. Given a question from the media buyer and matching records from this agent's own history, answer with at most 5 short bullets of relevant precedent, each starting with its date, and say plainly when nothing relevant exists. Use only the records given.`;

export async function searchHistory(agentId: string, query: string, ctx: { runId: string; budget: Budget; createMessage: CreateMessage }) {
  const hits = await grepHistory(agentId, query);
  if (!hits.length) {
    await emit({ agentId, runId: ctx.runId, step: "remembering", tier: "code", summary: `No precedent for "${query.slice(0, 60)}"`, evidence: { query, matches: 0 } });
    return "No matching history for this agent.";
  }
  const plan = planTier("librarian", ctx.budget);
  if (!plan) return hits.slice(0, 8).map((h) => `${h.when} · ${h.kind}: ${h.text}`).join("\n");
  const res = await callModel({
    task: "librarian",
    tier: plan.tier,
    degraded: plan.degraded,
    agentId,
    runId: ctx.runId,
    createMessage: ctx.createMessage,
    params: {
      max_tokens: 1200,
      output_config: { effort: "low" },
      system: [{ type: "text", text: LIBRARIAN_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Question: ${query}\n\nRecords:\n${hits.map((h) => `- ${h.when} · ${h.kind}: ${h.text}`).join("\n")}` }],
    },
  });
  const answer = textOf(res.message) || hits.slice(0, 5).map((h) => `${h.when} · ${h.text}`).join("\n");
  await emit({ agentId, runId: ctx.runId, step: "remembering", tier: "haiku", model: res.model, summary: `Found ${hits.length} related record(s) for "${query.slice(0, 60)}"`, evidence: { query, matches: hits.length }, inputTokens: res.usage.input, outputTokens: res.usage.output });
  return answer;
}
