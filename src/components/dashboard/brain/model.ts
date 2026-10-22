// Shared Brain vocabulary: tiers, the pipeline and the graph layout. Pure data, client-safe.
import type { BrainEvent } from "@/lib/migz/brain-types";

export type Tier = BrainEvent["tier"];

export const TIER: Record<Tier, { label: string; color: string }> = {
  opus: { label: "Opus 5.5", color: "#b7a4ff" },
  sonnet: { label: "Sonnet 5.5", color: "#f2a65a" },
  haiku: { label: "Haiku 5.5", color: "#82b4ff" },
  code: { label: "code", color: "#8bcf9f" },
  higgsfield: { label: "Higgsfield", color: "#e7c873" },
};

export const PIPELINE = ["sense", "audit", "research", "triage", "watch", "advise", "create", "act", "remember"] as const;
export type Stage = (typeof PIPELINE)[number];

export const STAGE_OF: Record<string, Stage> = {
  syncing: "sense",
  auditing: "audit",
  researching: "research",
  triaging: "triage",
  skipped: "triage",
  watching: "watch",
  advising: "advise",
  hypothesizing: "create",
  drafting: "create",
  checking: "act",
  acting: "act",
  remembering: "remember",
  finished: "remember",
};

export type NodeId = "opus" | "sonnet" | "code" | "auditor" | "librarian" | "scout" | "clerk" | "higgsfield" | "meta" | "memory";

/** Which graph node an event belongs to. */
export function nodeOf(e: Pick<BrainEvent, "step" | "tier">): NodeId {
  if (e.tier === "opus") return "opus";
  if (e.tier === "higgsfield") return "higgsfield";
  if (e.tier === "haiku") {
    if (e.step === "auditing") return "auditor";
    if (e.step === "remembering") return "librarian";
    if (e.step === "researching") return "scout";
    return "clerk";
  }
  if (e.tier === "sonnet") return "sonnet";
  // Reading results from Meta and making changes there both light the Meta node
  if (e.step === "acting" || e.step === "syncing") return "meta";
  if (e.step === "remembering" || e.step === "hypothesizing") return "memory";
  if (e.step === "researching") return "scout";
  return "code";
}

// Desktop layout in a 1000 x 590 viewBox
export const BOX: Record<NodeId, { x: number; y: number; w: number; h: number }> = {
  opus: { x: 14, y: 14, w: 236, h: 562 },
  sonnet: { x: 400, y: 14, w: 400, h: 104 },
  code: { x: 340, y: 166, w: 520, h: 86 },
  auditor: { x: 290, y: 306, w: 140, h: 104 },
  librarian: { x: 440, y: 306, w: 140, h: 104 },
  scout: { x: 620, y: 306, w: 140, h: 104 },
  clerk: { x: 770, y: 306, w: 140, h: 104 },
  higgsfield: { x: 360, y: 476, w: 160, h: 100 },
  meta: { x: 530, y: 476, w: 140, h: 100 },
  memory: { x: 680, y: 476, w: 160, h: 100 },
};

const fan = (x: number) => `M600 252 C600 282, ${x} 278, ${x} 306`;
const down = (x: number) => `M600 444 C600 462, ${x} 458, ${x} 476`;

export const PATHS: Record<string, string> = {
  "opus-sonnet": "M250 66 L400 66",
  "sonnet-code": "M600 118 L600 166",
  "code-auditor": fan(360),
  "code-librarian": fan(510),
  "code-scout": fan(690),
  "code-clerk": fan(840),
  spine: "M600 252 L600 444",
  "merge-higgsfield": down(440),
  "merge-meta": "M600 444 L600 476",
  "merge-memory": down(760),
};

/** The chain of connectors a light travels to reach a node from the lead (or from Opus). */
export const ROUTE: Record<NodeId, string[]> = {
  opus: ["opus-sonnet"],
  sonnet: [],
  code: ["sonnet-code"],
  auditor: ["sonnet-code", "code-auditor"],
  librarian: ["sonnet-code", "code-librarian"],
  scout: ["sonnet-code", "code-scout"],
  clerk: ["sonnet-code", "code-clerk"],
  higgsfield: ["sonnet-code", "spine", "merge-higgsfield"],
  meta: ["sonnet-code", "spine", "merge-meta"],
  memory: ["sonnet-code", "spine", "merge-memory"],
};

export const NODE_TIER: Record<NodeId, Tier> = {
  opus: "opus",
  sonnet: "sonnet",
  code: "code",
  auditor: "haiku",
  librarian: "haiku",
  scout: "haiku",
  clerk: "haiku",
  higgsfield: "higgsfield",
  meta: "code",
  memory: "code",
};

export const NODE_COPY: Record<NodeId, { title: string; role: string }> = {
  opus: { title: "Opus 5.5", role: "advisor · on call" },
  sonnet: { title: "Sonnet 5.5", role: "lead · runs the review" },
  code: { title: "code", role: "sync · gate · guardrails · spend switch" },
  auditor: { title: "audit", role: "checks the account" },
  librarian: { title: "history", role: "greps past results" },
  scout: { title: "market", role: "studies other ads" },
  clerk: { title: "clerk", role: "copy check · feed" },
  higgsfield: { title: "Higgsfield", role: "makes creatives" },
  meta: { title: "Meta", role: "reads results · applies changes" },
  memory: { title: "memory", role: "experiments · learnings" },
};
