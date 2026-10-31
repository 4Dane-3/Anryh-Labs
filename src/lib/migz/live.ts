import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { graphAll } from "@/lib/meta/graph";
import { getActiveBatch, getBatchProgress } from "@/lib/dashboard/batches";
import { begin, emit } from "@/lib/migz/events";
import { callModel, defaultCreateMessage, jsonOf, monthlyBudget, planTier, type CreateMessage } from "@/lib/migz/router";
import { PULSE_KIND, type LiveStats } from "@/lib/migz/brain-types";

// The Brain's live layer, between full reviews. Two real things, nothing simulated:
//  - getLiveStats: today's numbers straight from Meta (and what Migz has cost), refreshed while the
//    Brain page is open;
//  - pulseIfDue: every PULSE_EVERY_MIN while someone is watching, Migz reads those numbers, recalls what
//    the account has taught it, and Sonnet writes a short note on how today compares. Read-only: a pulse
//    never changes the account; anything it notices waits for the next review.

export const PULSE_EVERY_MIN = 10;
const STATS_TTL_MS = 50_000; // Meta's numbers move every few minutes; don't ask it on every poll

const cents = (dollars: string | number | undefined) => Math.round(Number(dollars ?? 0) * 100);
const cache = new Map<string, { at: number; stats: LiveStats }>();

type TodayRow = { spend?: string; impressions?: string; reach?: string; inline_link_clicks?: string; date_start?: string };
type AdRow = TodayRow & { ad_id: string; ad_name: string };
type HourRow = TodayRow & { hourly_stats_aggregated_by_advertiser_time_zone: string };

/** Today so far, from Meta and our own tables. Cached briefly per agent; `fresh` skips the cache. */
export async function getLiveStats(agent: Agent, opts: { fresh?: boolean; date?: string } = {}): Promise<LiveStats> {
  // `date` (YYYY-MM-DD) asks for one specific day (the nightly summary's day) instead of Meta's "today"
  const hit = cache.get(`${agent.id}:${opts.date ?? ""}`);
  if (!opts.fresh && hit && Date.now() - hit.at < STATS_TTL_MS) return hit.stats;

  const zone = agent.timezone;
  const dayStart = opts.date ? DateTime.fromISO(opts.date, { zone }).startOf("day") : DateTime.now().setZone(zone).startOf("day");
  const when = opts.date ? { time_range: { since: opts.date, until: opts.date } } : { date_preset: "today" };
  const monthStart = DateTime.now().startOf("month").toUTC().toISO()!;
  const account = agent.meta_ad_account_id;

  const meta = account
    ? Promise.all([
        graphAll<TodayRow>(`${account}/insights`, { level: "account", ...when, fields: "spend,impressions,reach,inline_link_clicks,date_start" }),
        graphAll<AdRow>(`${account}/insights`, { level: "ad", ...when, fields: "ad_id,ad_name,spend,impressions,inline_link_clicks", limit: 200 }),
        graphAll<HourRow>(`${account}/insights`, { level: "account", ...when, breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", fields: "spend,impressions", limit: 48 }),
      ]).then(
        ([total, ads, hours]) => ({ total: total[0] ?? null, ads, hours, error: null }),
        (e: unknown) => ({ total: null, ads: [] as AdRow[], hours: [] as HourRow[], error: e instanceof Error ? e.message : String(e) }),
      )
    : Promise.resolve({ total: null, ads: [] as AdRow[], hours: [] as HourRow[], error: null });

  const [m, adsets, bookings, calls, budget, batch, synced, adRows] = await Promise.all([
    meta,
    supabaseAdmin.from("ad_sets").select("daily_budget_cents, ad_campaigns!inner(retired_at)").eq("agent_id", agent.id).eq("status", "ACTIVE").is("ad_campaigns.retired_at", null),
    supabaseAdmin.from("bookings").select("attribution").eq("agent_id", agent.id).gte("created_at", dayStart.toUTC().toISO()!).lt("created_at", dayStart.plus({ days: 1 }).toUTC().toISO()!),
    supabaseAdmin.from("model_calls").select("created_at").eq("agent_id", agent.id).gte("created_at", monthStart),
    monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000, agent.timezone),
    getActiveBatch(agent.id),
    supabaseAdmin.from("ad_metrics_daily").select("spend_cents").eq("agent_id", agent.id).eq("date", dayStart.toISODate()!).maybeSingle(),
    // Which ads of the current campaign are paused (the ad, its ad set or its campaign)
    supabaseAdmin
      .from("ads")
      .select("meta_ad_id, name, status, ad_sets!inner(status, ad_campaigns!inner(status, retired_at))")
      .eq("agent_id", agent.id)
      .is("ad_sets.ad_campaigns.retired_at", null),
  ]);

  const spendCents = cents(m.total?.spend);
  const impressions = Number(m.total?.impressions ?? 0);
  const linkClicks = Number(m.total?.inline_link_clicks ?? 0);
  const startOfDay = dayStart.toUTC().toISO()!;
  const callsToday = (calls.data ?? []).filter((c) => c.created_at >= startOfDay);

  let batchStats: LiveStats["batch"] = null;
  if (batch?.starts_on) {
    const p = await getBatchProgress(agent, batch);
    // The batch total comes from the hourly sync; swap its copy of today for Meta's live number
    const spent = Math.max(0, p.spentCents - (synced.data?.spend_cents ?? 0)) + spendCents;
    batchStats = { spentCents: spent, budgetCents: batch.budget_cents, day: Math.min(p.day, batch.days), days: batch.days };
  }

  const pausedRows = (adRows.data ?? []).filter((a) => {
    const set = Array.isArray(a.ad_sets) ? a.ad_sets[0] : a.ad_sets;
    const campaign = set && (Array.isArray(set.ad_campaigns) ? set.ad_campaigns[0] : set.ad_campaigns);
    return a.status === "PAUSED" || set?.status === "PAUSED" || campaign?.status === "PAUSED";
  });
  const pausedIds = new Set(pausedRows.map((a) => a.meta_ad_id));
  const todayById = new Map(m.ads.map((a) => [a.ad_id, a]));

  const stats: LiveStats = {
    agentId: agent.id,
    at: new Date().toISOString(),
    hourNow: DateTime.now().setZone(zone).hour,
    connected: !!account,
    error: m.error,
    today: {
      date: m.total?.date_start ?? dayStart.toISODate()!,
      spendCents,
      budgetCents: (adsets.data ?? []).reduce((s, a) => s + (a.daily_budget_cents ?? 0), 0),
      impressions,
      reach: Number(m.total?.reach ?? 0),
      linkClicks,
      ctr: impressions ? linkClicks / impressions : null,
      cpmCents: impressions ? Math.round((spendCents / impressions) * 1000) : null,
      cpcCents: linkClicks ? Math.round(spendCents / linkClicks) : null,
      bookedCalls: (bookings.data ?? []).filter((b) => (b.attribution as Record<string, string> | null)?.utm_source === "meta").length,
    },
    hours: m.hours
      .map((h) => ({ hour: Number(h.hourly_stats_aggregated_by_advertiser_time_zone.slice(0, 2)), spendCents: cents(h.spend), impressions: Number(h.impressions ?? 0) }))
      .sort((a, b) => a.hour - b.hour),
    ads: m.ads
      .map((a) => ({ adId: a.ad_id, name: a.ad_name.replace(/^Migz · /, ""), spendCents: cents(a.spend), impressions: Number(a.impressions ?? 0), linkClicks: Number(a.inline_link_clicks ?? 0), paused: pausedIds.has(a.ad_id) }))
      .sort((a, b) => b.spendCents - a.spendCents || b.impressions - a.impressions)
      .slice(0, 6),
    pausedAds: pausedRows
      .map((a) => {
        const t = todayById.get(a.meta_ad_id);
        return { adId: a.meta_ad_id, name: a.name.replace(/^Migz · /, ""), spendCents: cents(t?.spend), impressions: Number(t?.impressions ?? 0), linkClicks: Number(t?.inline_link_clicks ?? 0) };
      })
      .sort((a, b) => b.spendCents - a.spendCents || b.impressions - a.impressions)
      .slice(0, 6),
    batch: batchStats,
    migz: {
      callsToday: callsToday.length,
      // light: today's share of the AI budget is used, so cheaper models until midnight; saving: optional work paused
      pace: budget.ratio >= 1 ? "light" : budget.ratio >= 0.8 ? "saving" : "normal",
    },
  };
  cache.set(`${agent.id}:${opts.date ?? ""}`, { at: Date.now(), stats });
  return stats;
}

/** A pulse is due when the last one is at least PULSE_EVERY_MIN old and no review is running. Pure. */
export function pulseDue(lastPulseAt: string | null, reviewRunning: boolean, now = Date.now()) {
  if (reviewRunning) return false;
  return !lastPulseAt || now - new Date(lastPulseAt).getTime() >= PULSE_EVERY_MIN * 60_000;
}

const WATCH_SYSTEM = `You are Migz AI, keeping an eye on an independent life insurance agent's Meta ads between full reviews. You get today's numbers so far, the numbers from your previous check, the campaign batch's pacing, and what this account has taught you. You can't change anything right now: changes only happen in full reviews.

Write one short note for the agent (at most 40 words, plain words, no hype, no exclamation marks) saying what today's numbers show and how they compare with the previous check or with what you've learned. Use only the numbers you're given; if almost nothing has happened yet, say so plainly. Then pick a flag: "steady" (nothing to act on), "watch" (worth keeping an eye on), or "review" (raise it at the next full review).`;

const WATCH_SCHEMA = {
  type: "object",
  properties: {
    note: { type: "string" },
    flag: { type: "string", enum: ["steady", "watch", "review"] },
  },
  required: ["note", "flag"],
  additionalProperties: false,
};

type Recall = { learnings: string[]; experiments: string[]; lastReview: string | null; previous: { at: string; note: string; today: LiveStats["today"] | null } | null };

/**
 * One check-in, if one is due: Meta (today's numbers) -> memory (what the account has taught Migz) ->
 * Sonnet (a short note). Each step is a real Brain event, so the graph lights only what is working.
 * Returns why it didn't run, or "pulsed".
 */
export async function pulseIfDue(agent: Agent, createMessage: CreateMessage = defaultCreateMessage) {
  if (!agent.meta_ad_account_id || !agent.onboarding_completed_at || agent.migz_mode === "off") return "off";
  // Two tabs (or a page load's first polls) can ask at once: one check-in per agent at a time
  if (pulsing.has(agent.id)) return "not_due";
  pulsing.add(agent.id);
  try {
    return await pulse(agent, createMessage);
  } finally {
    pulsing.delete(agent.id);
  }
}

const pulsing = new Set<string>();

async function pulse(agent: Agent, createMessage: CreateMessage) {
  const [{ data: run }, { data: last }] = await Promise.all([
    supabaseAdmin.from("migz_runs").select("status, started_at").eq("agent_id", agent.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("migz_events").select("started_at").eq("agent_id", agent.id).eq("evidence->>kind", PULSE_KIND).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const reviewRunning = run?.status === "running" && Date.now() - new Date(run.started_at).getTime() < 10 * 60_000;
  if (!pulseDue(last?.started_at ?? null, reviewRunning)) return "not_due";

  const base = { agentId: agent.id, runId: null, evidence: { kind: PULSE_KIND } };

  // 1. Meta: today's numbers
  const reading = await begin({ ...base, step: "syncing", tier: "code", summary: "Reading today's numbers from Meta" });
  let stats: LiveStats;
  try {
    stats = await getLiveStats(agent, { fresh: true });
  } catch (e) {
    await reading({ summary: `Couldn't read today's numbers: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`, evidence: base.evidence });
    return "failed";
  }
  const t = stats.today;
  await reading({
    summary: stats.error
      ? `Meta didn't answer this time: ${stats.error.slice(0, 120)}`
      : `Today so far: $${(t.spendCents / 100).toFixed(2)} spent, ${t.impressions.toLocaleString("en-US")} impressions, ${t.linkClicks} link clicks`,
    evidence: { kind: PULSE_KIND, spend: `$${(t.spendCents / 100).toFixed(2)}`, booked_calls: t.bookedCalls },
  });
  if (stats.error) return "failed";

  // 2. Memory: what this account has taught Migz, and the previous check
  const recalling = await begin({ ...base, step: "remembering", tier: "code", summary: "Recalling what this account has taught Migz" });
  const [learnings, experiments, review, previous] = await Promise.all([
    supabaseAdmin.from("learnings").select("insight").eq("agent_id", agent.id).eq("active", true).order("created_at", { ascending: false }).limit(6),
    supabaseAdmin.from("experiments").select("hypothesis").eq("agent_id", agent.id).eq("status", "running").limit(4),
    supabaseAdmin.from("migz_runs").select("summary").eq("agent_id", agent.id).eq("status", "succeeded").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("migz_events").select("started_at, summary, evidence").eq("agent_id", agent.id).eq("step", "watching").eq("evidence->>kind", PULSE_KIND).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const recall: Recall = {
    learnings: (learnings.data ?? []).map((l) => l.insight),
    experiments: (experiments.data ?? []).map((e) => e.hypothesis),
    lastReview: review.data?.summary ?? null,
    previous: previous.data
      ? { at: previous.data.started_at, note: previous.data.summary, today: ((previous.data.evidence as { today?: LiveStats["today"] }).today ?? null) }
      : null,
  };
  const recalled = [
    `${recall.learnings.length} learning${recall.learnings.length === 1 ? "" : "s"}`,
    `${recall.experiments.length} running experiment${recall.experiments.length === 1 ? "" : "s"}`,
    recall.lastReview ? "the last review" : null,
    recall.previous ? "the previous check" : null,
  ].filter(Boolean);
  await recalling({ summary: `Recalled ${recalled.join(", ")}`, evidence: { kind: PULSE_KIND } });

  // 3. Sonnet: a short note (skipped near today's share of the model budget; the numbers above still update)
  const budget = await monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000, agent.timezone);
  const plan = planTier("watch", budget);
  if (!plan) {
    await emit({ ...base, step: "watching", tier: "code", summary: "Sonnet is resting to keep today within its share of the month's AI budget; Migz keeps reading the numbers", evidence: { kind: PULSE_KIND, today: t } });
    return "pulsed";
  }
  const thinking = await begin({ ...base, step: "watching", tier: plan.tier, summary: "Comparing today with earlier checks" });
  try {
    const res = await callModel({
      task: "watch",
      tier: plan.tier,
      degraded: plan.degraded,
      agentId: agent.id,
      runId: null,
      createMessage,
      params: {
        max_tokens: 400,
        output_config: { effort: "low", format: { type: "json_schema", schema: WATCH_SCHEMA } },
        system: [{ type: "text", text: WATCH_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              now_local: DateTime.now().setZone(agent.timezone).toFormat("cccc h:mm a"),
              today: { ...t, spend: `$${(t.spendCents / 100).toFixed(2)}`, daily_budget: `$${(t.budgetCents / 100).toFixed(2)}` },
              spend_by_hour: stats.hours.map((h) => ({ hour: h.hour, spend: `$${(h.spendCents / 100).toFixed(2)}`, impressions: h.impressions })),
              ads_today: stats.ads.map((a) => ({ ad: a.name, spend: `$${(a.spendCents / 100).toFixed(2)}`, impressions: a.impressions, link_clicks: a.linkClicks })),
              batch: stats.batch && { day: stats.batch.day, of_days: stats.batch.days, spent: `$${(stats.batch.spentCents / 100).toFixed(2)}`, budget: `$${(stats.batch.budgetCents / 100).toFixed(2)}` },
              previous_check: recall.previous,
              learnings: recall.learnings,
              running_experiments: recall.experiments,
              last_review: recall.lastReview,
            }),
          },
        ],
      },
    });
    const out = jsonOf<{ note: string; flag: "steady" | "watch" | "review" }>(res.message);
    await thinking({
      summary: out?.note?.trim() || "Checked today's numbers; nothing to add",
      evidence: { kind: PULSE_KIND, flag: out?.flag ?? "steady", today: t },
      inputTokens: res.usage.input,
      outputTokens: res.usage.output,
      model: res.model,
    });
  } catch (e) {
    await thinking({ summary: `Couldn't finish this check: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`, evidence: { kind: PULSE_KIND, today: t } });
    return "failed";
  }
  return "pulsed";
}
