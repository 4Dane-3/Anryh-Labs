import type { BrainEvent, BrainLive } from "@/lib/migz/brain-types";
import { nodeOf, PIPELINE, STAGE_OF, type NodeId, type Stage } from "@/components/dashboard/brain/model";

export type NodeState = { status: "idle" | "done" | "active"; last: BrainEvent | null; count: number };

// A step left open longer than this crashed without closing; don't keep it lit forever
const STALE_MS = 30 * 60_000;

/** Steps still running (a review's, or background work like a generation or a Meta upload). */
export function openEvents(live: BrainLive, now = Date.now()) {
  return live.events.filter((e) => !e.finished_at && now - new Date(e.started_at).getTime() < STALE_MS);
}

/** True while any part of Migz is working: a review, or background work outside one. */
export function isBusy(live: BrainLive, now = Date.now()) {
  return live.running || openEvents(live, now).length > 0;
}

/**
 * What the graph should show, derived only from real events. A node pulses whenever it is actually
 * working: during a review, and also for background work outside one (Higgsfield making a creative,
 * Migz building an ad in Meta after an approval).
 */
export function deriveGraph(live: BrainLive, now = Date.now()) {
  const runId = live.runId;
  const runStart = live.lastRun ? new Date(live.lastRun.started_at).getTime() : 0;
  // The review's own steps, plus background steps since it started (they belong to no run)
  const runEvents = live.events.filter(
    (e) => (runId && e.run_id === runId) || (e.run_id !== runId && new Date(e.started_at).getTime() >= runStart && (e.run_id === null || !e.finished_at)),
  );
  const nodes = {} as Record<NodeId, NodeState>;
  for (const id of ["opus", "sonnet", "code", "auditor", "librarian", "scout", "clerk", "higgsfield", "meta", "memory"] as NodeId[])
    nodes[id] = { status: "idle", last: null, count: 0 };

  for (const e of runEvents) {
    const n = nodes[nodeOf(e)];
    n.count++;
    n.last = e;
    if (n.status !== "active") n.status = "done";
  }

  const active = new Set<NodeId>();
  const open = openEvents(live, now);
  for (const e of open) active.add(nodeOf(e));
  // A step that just closed keeps its light for a beat
  for (const e of live.events) if (e.finished_at && now - new Date(e.finished_at).getTime() < 4000) active.add(nodeOf(e));
  // Between steps of a review, the lead is thinking
  if (live.running && !open.some((e) => e.run_id === runId)) active.add("sonnet");
  for (const id of active) nodes[id].status = "active";

  const stages = new Set<Stage>(runEvents.map((e) => STAGE_OF[e.step]).filter(Boolean));
  const activeStages = new Set<Stage>(open.map((e) => STAGE_OF[e.step]).filter(Boolean));
  if (live.running && !activeStages.size && runEvents.at(-1)) activeStages.add(STAGE_OF[runEvents.at(-1)!.step]);

  return {
    nodes,
    active,
    runEvents,
    pipeline: PIPELINE.map((s) => ({ stage: s, status: activeStages.has(s) ? "active" : stages.has(s) ? "done" : "idle" }) as const),
    advisorCalls: runEvents.filter((e) => e.step === "advising").length,
    skipped: runEvents.some((e) => e.step === "skipped"),
  };
}

export type GraphState = ReturnType<typeof deriveGraph>;
