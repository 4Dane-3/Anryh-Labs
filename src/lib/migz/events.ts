import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Step events: a running log of what each Migz run is doing, written as it happens. The Brain page
// animates from these rows only, so nothing on it is invented.

export type Step =
  | "syncing"
  | "auditing"
  | "triaging"
  | "researching"
  | "watching"
  | "advising"
  | "hypothesizing"
  | "drafting"
  | "checking"
  | "acting"
  | "remembering"
  | "finished"
  | "skipped";

export type Tier = "code" | "haiku" | "sonnet" | "opus" | "higgsfield";

export type EventInput = {
  agentId: string;
  runId: string | null;
  step: Step;
  tier: Tier;
  model?: string | null;
  summary: string;
  evidence?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
};

/** Records a finished step. */
export async function emit(e: EventInput) {
  const now = new Date().toISOString();
  await supabaseAdmin.from("migz_events").insert({
    agent_id: e.agentId,
    run_id: e.runId,
    step: e.step,
    tier: e.tier,
    model: e.model ?? null,
    summary: e.summary.slice(0, 400),
    evidence: e.evidence ?? {},
    input_tokens: e.inputTokens ?? 0,
    output_tokens: e.outputTokens ?? 0,
    started_at: now,
    finished_at: now,
  });
}

/** Opens a step now (so the Brain page lights it while it runs) and returns a function that closes it. */
export async function begin(e: EventInput) {
  const { data } = await supabaseAdmin
    .from("migz_events")
    .insert({
      agent_id: e.agentId,
      run_id: e.runId,
      step: e.step,
      tier: e.tier,
      model: e.model ?? null,
      summary: e.summary.slice(0, 400),
      evidence: e.evidence ?? {},
    })
    .select("id")
    .single();
  const id = data?.id as number | undefined;
  return async (end: { summary?: string; evidence?: Record<string, unknown>; inputTokens?: number; outputTokens?: number } = {}) => {
    if (!id) return;
    await supabaseAdmin
      .from("migz_events")
      .update({
        ...(end.summary ? { summary: end.summary.slice(0, 400) } : {}),
        ...(end.evidence ? { evidence: end.evidence } : {}),
        input_tokens: end.inputTokens ?? 0,
        output_tokens: end.outputTokens ?? 0,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id);
  };
}
