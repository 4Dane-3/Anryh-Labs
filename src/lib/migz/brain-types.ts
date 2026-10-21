// Client-safe shapes for the Brain page (the queries live in brain.ts, which is server-only).

export type BrainEvent = {
  id: number;
  run_id: string | null;
  step: string;
  tier: "code" | "haiku" | "sonnet" | "opus" | "higgsfield";
  model: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  input_tokens: number;
  output_tokens: number;
  started_at: string;
  finished_at: string | null;
};

export type BrainLive = {
  now: string;
  running: boolean;
  runId: string | null;
  lastRun: { status: string; finished_at: string | null; started_at: string; summary: string | null; skipped_reason: string | null } | null;
  nextRunAt: string | null;
  mode: string;
  events: BrainEvent[];
};

export type Scorecard = {
  ad_id: string;
  name: string;
  kind: string | null;
  hook: string | null;
  impressions: number;
  hook_rate: number | null;
  hold_rate: number | null;
  retention: { p25: number | null; p50: number | null; p75: number | null; p100: number | null } | null;
  link_ctr: number | null;
  booked_calls: number;
  cost_per_booked_call: number | null;
  verdict: { rung: string; read: string };
  traits: { angle?: string; hook_type?: string } | null;
};

