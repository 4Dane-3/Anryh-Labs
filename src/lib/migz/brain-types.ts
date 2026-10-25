// Client-safe shapes for the Brain page (the queries live in brain.ts, which is server-only).

/** Brain events from the live monitor carry evidence.kind = "pulse"; the page keeps this many of them. */
export const PULSE_KIND = "pulse";
export const PULSE_KEEP = 30;
export const isPulse = (e: { evidence?: Record<string, unknown> | null }) => e.evidence?.kind === PULSE_KIND;
/** Steps from the research shift (market, history, clerk, memory around the clock). */
export const RESEARCH_KIND = "research";
/** Work between reviews (live check-ins and the research shift): loaded and trimmed apart from reviews. */
export const isBackground = (e: { evidence?: Record<string, unknown> | null }) => e.evidence?.kind === PULSE_KIND || e.evidence?.kind === RESEARCH_KIND;

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
  agentId: string; // whose Brain this is: a refresh for another account means the page is stale
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
  topic: string | null;
};


/** Today's numbers straight from Meta, plus what Migz itself has cost. Refreshed while the Brain is open. */
export type LiveStats = {
  agentId: string;
  at: string;
  hourNow: number; // the current hour (0-23) in the agent's timezone
  connected: boolean;
  error: string | null;
  today: {
    date: string;
    spendCents: number;
    budgetCents: number; // the live ad sets' daily budgets added up
    impressions: number;
    reach: number;
    linkClicks: number;
    ctr: number | null; // link clicks / impressions
    cpmCents: number | null;
    cpcCents: number | null; // per link click
    bookedCalls: number;
  };
  hours: { hour: number; spendCents: number; impressions: number }[]; // 0-23 in the ad account's timezone, up to now
  ads: { adId: string; name: string; spendCents: number; impressions: number; linkClicks: number }[];
  batch: { spentCents: number; budgetCents: number; day: number; days: number } | null;
  migz: { todayUsd: number; monthUsd: number; limitUsd: number; dailyUsd: number; callsToday: number };
};
