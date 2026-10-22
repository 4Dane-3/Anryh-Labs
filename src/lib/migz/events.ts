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

/** Opens a step and returns its id, for work that outlives one request (a generation, a Meta upload). */
export async function openEvent(e: EventInput) {
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
  return (data?.id as number | undefined) ?? null;
}

type EventEnd = { summary?: string; evidence?: Record<string, unknown>; inputTokens?: number; outputTokens?: number; tier?: Tier; model?: string | null };

/** Closes a step opened with openEvent (or begin). */
export async function closeEvent(id: number | null | undefined, end: EventEnd = {}) {
  if (!id) return;
  await supabaseAdmin
    .from("migz_events")
    .update({
      ...(end.summary ? { summary: end.summary.slice(0, 400) } : {}),
      ...(end.evidence ? { evidence: end.evidence } : {}),
      ...(end.tier ? { tier: end.tier } : {}),
      ...(end.model ? { model: end.model } : {}),
      ...(end.inputTokens !== undefined ? { input_tokens: end.inputTokens } : {}),
      ...(end.outputTokens !== undefined ? { output_tokens: end.outputTokens } : {}),
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/** Opens a step now (so the Brain page lights it while it runs) and returns a function that closes it. */
export async function begin(e: EventInput) {
  const id = await openEvent(e);
  return (end: EventEnd = {}) => closeEvent(id, { inputTokens: 0, outputTokens: 0, ...end });
}

/**
 * Runs Meta work as an open "acting" step, so the Brain's Meta node is lit for as long as Migz is
 * actually in the ad account (not just for a moment afterwards).
 */
export async function metaStep<T>(
  e: { agentId: string; runId: string | null; summary: string },
  work: () => Promise<T>,
  doneSummary?: (result: T) => string,
): Promise<T> {
  const done = await begin({ agentId: e.agentId, runId: e.runId, step: "acting", tier: "code", summary: e.summary });
  try {
    const result = await work();
    await done({ summary: doneSummary?.(result) });
    return result;
  } catch (err) {
    await done({ summary: `${e.summary}: failed (${err instanceof Error ? err.message.slice(0, 120) : "error"})` });
    throw err;
  }
}
