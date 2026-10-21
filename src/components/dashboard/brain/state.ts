import type { BrainEvent, BrainLive } from "@/lib/migz/brain-types";
import { nodeOf, PIPELINE, STAGE_OF, type NodeId, type Stage } from "@/components/dashboard/brain/model";

export type NodeState = { status: "idle" | "done" | "active"; last: BrainEvent | null; count: number };

/** What the graph should show, derived only from real events. */
export function deriveGraph(live: BrainLive, now = Date.now()) {
  const runId = live.runId;
  const runEvents = runId ? live.events.filter((e) => e.run_id === runId) : [];
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
  if (live.running) {
    for (const e of runEvents) if (!e.finished_at) active.add(nodeOf(e));
    // Between steps, the lead is thinking; a step that just closed keeps its light for a beat
    const latest = runEvents.at(-1);
    if (latest?.finished_at && now - new Date(latest.finished_at).getTime() < 4000) active.add(nodeOf(latest));
    if (!active.size) active.add("sonnet");
  }
  for (const id of active) nodes[id].status = "active";

  const stages = new Set<Stage>(runEvents.map((e) => STAGE_OF[e.step]).filter(Boolean));
  const activeStages = new Set<Stage>([...runEvents.filter((e) => live.running && !e.finished_at).map((e) => STAGE_OF[e.step])]);
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
