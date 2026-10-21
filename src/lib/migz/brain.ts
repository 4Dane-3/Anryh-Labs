import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { buildSnapshot } from "@/lib/migz/snapshot";
import { ladder } from "@/lib/migz/vision";
import type { BrainEvent, BrainLive, Scorecard } from "@/lib/migz/brain-types";

export type { BrainEvent, BrainLive } from "@/lib/migz/brain-types";

// Everything the Brain page shows, read from the real tables. The live part (events) is polled.

export const REVIEW_EVERY_HOURS = 6;

const EVENT_COLS = "id, run_id, step, tier, model, summary, evidence, input_tokens, output_tokens, started_at, finished_at";

/** The live slice: run status and the latest events (or only those after an id). */
export async function getBrainLive(agent: Agent, afterId?: number): Promise<BrainLive> {
  const [{ data: runs }, events] = await Promise.all([
    supabaseAdmin.from("migz_runs").select("id, status, started_at, finished_at, summary, skipped_reason").eq("agent_id", agent.id).order("started_at", { ascending: false }).limit(1),
    afterId
      ? supabaseAdmin.from("migz_events").select(EVENT_COLS).eq("agent_id", agent.id).gt("id", afterId).order("id").limit(200)
      : supabaseAdmin.from("migz_events").select(EVENT_COLS).eq("agent_id", agent.id).order("id", { ascending: false }).limit(80),
  ]);
  const last = runs?.[0] ?? null;
  // A run that's been "running" for over 10 minutes died without finishing (function timeout)
  const running = !!last && last.status === "running" && Date.now() - new Date(last.started_at).getTime() < 10 * 60_000;
  const lastAt = agent.migz_last_run_at ? DateTime.fromISO(agent.migz_last_run_at) : null;
  // Reviews are checked hourly (pg_cron) and run at most every 6 hours
  const next = lastAt ? DateTime.max(lastAt.plus({ hours: REVIEW_EVERY_HOURS }), DateTime.now().plus({ hours: 1 }).startOf("hour")) : DateTime.now().plus({ hours: 1 }).startOf("hour");
  const list = ((events.data ?? []) as BrainEvent[]).slice();
  if (!afterId) list.reverse();
  return {
    now: new Date().toISOString(),
    running,
    runId: last?.id ?? null,
    lastRun: last ? { status: last.status, started_at: last.started_at, finished_at: last.finished_at, summary: last.summary, skipped_reason: last.skipped_reason } : null,
    nextRunAt: agent.migz_mode === "off" ? null : next.toISO(),
    mode: agent.migz_mode,
    events: list,
  };
}

/** Everything else on the page: findings, experiments, learnings, swipe file, scorecards, costs. */
export async function getBrainBoard(agent: Agent) {
  const monthStart = DateTime.now().startOf("month").toUTC().toISO()!;
  const [findings, experiments, learnings, swipes, calls, snapshot, ads] = await Promise.all([
    supabaseAdmin.from("audit_findings").select("check_name, subject, severity, summary, first_seen, last_seen, status").eq("agent_id", agent.id).or(`status.eq.open,resolved_at.gte.${DateTime.now().minus({ days: 3 }).toUTC().toISO()}`).order("last_seen", { ascending: false }).limit(30),
    supabaseAdmin.from("experiments").select("id, hypothesis, lever, success_metric, variants, min_impressions, min_thruplays, status, verdict, winner_label, result, created_at, concluded_at").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(12),
    supabaseAdmin.from("learnings").select("id, insight, confidence, source, created_at").eq("agent_id", agent.id).eq("active", true).order("created_at", { ascending: false }).limit(24),
    supabaseAdmin.from("swipe_files").select("id, source_url, advertiser, notes, traits, added_by, created_at").or(`agent_id.is.null,agent_id.eq.${agent.id}`).order("created_at", { ascending: false }).limit(12),
    supabaseAdmin.from("model_calls").select("tier, task, cost_usd, input_tokens, output_tokens, cache_read_tokens").eq("agent_id", agent.id).gte("created_at", monthStart),
    buildSnapshot(agent),
    supabaseAdmin.from("ads").select("meta_ad_id, name, status, adset_id, creatives(kind, hook, traits, script)").eq("agent_id", agent.id).eq("status", "ACTIVE"),
  ]);

  const byTier = { haiku: 0, sonnet: 0, opus: 0 } as Record<"haiku" | "sonnet" | "opus", number>;
  const tokens = { haiku: 0, sonnet: 0, opus: 0 } as Record<"haiku" | "sonnet" | "opus", number>;
  let advisorCalls = 0;
  for (const c of calls.data ?? []) {
    const t = c.tier as "haiku" | "sonnet" | "opus";
    byTier[t] += Number(c.cost_usd);
    tokens[t] += c.input_tokens + c.output_tokens + c.cache_read_tokens;
    if (c.task === "advisor") advisorCalls++;
  }

  // Scorecards: each live ad against its own ad set's average, through the diagnosis ladder
  const scorecards: Scorecard[] = [];
  const setAvg = new Map<string, { hook_rate: number | null; hold_rate: number | null; link_ctr: number | null; visit_to_booking: number | null; frequency: number | null }>();
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  for (const s of snapshot.guardAdsets) {
    const ds = s.ads.map((a) => snapshot.adMetrics.get(a.meta_ad_id)?.d14).filter((d): d is NonNullable<typeof d> => !!d);
    setAvg.set(s.meta_adset_id, {
      hook_rate: mean(ds.map((d) => d.hook_rate)),
      hold_rate: mean(ds.map((d) => d.hold_rate)),
      link_ctr: mean(ds.map((d) => d.link_ctr)),
      visit_to_booking: mean(ds.map((d) => d.visit_to_booking)),
      frequency: mean(ds.map((d) => d.frequency)),
    });
  }
  for (const ad of ads.data ?? []) {
    const m = snapshot.adMetrics.get(ad.meta_ad_id);
    const set = snapshot.guardAdsets.find((s) => s.ads.some((a) => a.meta_ad_id === ad.meta_ad_id));
    const c = ad.creatives as { kind?: string; hook?: string; traits?: { angle?: string; hook_type?: string }; script?: { topic?: string } } | null;
    const d = m?.d14;
    scorecards.push({
      ad_id: ad.meta_ad_id,
      name: ad.name,
      kind: c?.kind ?? null,
      hook: c?.hook ?? null,
      impressions: d?.impressions ?? 0,
      hook_rate: d?.hook_rate ?? null,
      hold_rate: d?.hold_rate ?? null,
      retention: d?.retention ?? null,
      link_ctr: d?.link_ctr ?? d?.ctr ?? null,
      booked_calls: d?.booked_calls ?? 0,
      cost_per_booked_call: d?.cost_per_booked_call_usd ?? null,
      verdict: d && set
        ? ladder({ hook_rate: d.hook_rate, hold_rate: d.hold_rate, link_ctr: d.link_ctr, visit_to_booking: d.visit_to_booking, frequency: d.frequency, impressions: d.impressions, visits: d.visits }, setAvg.get(set.meta_adset_id)!, m!.fatigue.signals)
        : { rung: "too_early", read: "No results yet." },
      traits: c?.traits ? { angle: c.traits.angle, hook_type: c.traits.hook_type } : null,
      topic: c?.script?.topic ?? null,
    });
  }
  scorecards.sort((a, b) => b.impressions - a.impressions);

  return {
    findings: findings.data ?? [],
    experiments: experiments.data ?? [],
    learnings: learnings.data ?? [],
    swipes: swipes.data ?? [],
    scorecards,
    focus: snapshot.focus,
    liveByTopic: snapshot.forModel.live_ads_by_topic as Record<string, number>,
    cost: {
      month: DateTime.now().toFormat("LLLL"),
      byTier,
      tokens,
      advisorCalls,
      totalUsd: byTier.haiku + byTier.sonnet + byTier.opus,
      limitUsd: (agent.migz_model_budget_cents ?? 3000) / 100,
    },
  };
}

export type BrainBoard = Awaited<ReturnType<typeof getBrainBoard>>;
