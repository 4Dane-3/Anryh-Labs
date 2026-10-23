import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getActiveBatch, getBatchProgress } from "@/lib/dashboard/batches";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { getLiveStats } from "@/lib/migz/live";
import { integrations } from "@/lib/integrations";
import type { AdminAlert, AdminOverview, AdminAgentRow } from "@/lib/admin/types";

// Everything the admin dashboard shows, read live: every agent's state (today's numbers straight from
// Meta, cached briefly), the open alerts, and what Migz is doing right now across all accounts.

const RECENT_RESOLVED_DAYS = 3;

async function agentRow(agent: Agent, alerts: AdminAlert[], working: string | null, modelSpentUsd: number): Promise<AdminAgentRow> {
  const [batch, balance, run, live, liveAds] = await Promise.all([
    getActiveBatch(agent.id),
    getBalanceCents(agent.id),
    supabaseAdmin.from("migz_runs").select("status, started_at, finished_at").eq("agent_id", agent.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    agent.meta_ad_account_id ? getLiveStats(agent).catch(() => null) : Promise.resolve(null),
    supabaseAdmin.from("ads").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("status", "ACTIVE"),
  ]);
  let batchInfo: AdminAgentRow["batch"] = null;
  if (batch?.starts_on) {
    const p = await getBatchProgress(agent, batch);
    batchInfo = { day: Math.min(p.day, batch.days), days: batch.days, budgetCents: batch.budget_cents, spentCents: live?.batch?.spentCents ?? p.spentCents };
  }
  const mine = alerts.filter((a) => a.agentId === agent.id);
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.full_name,
    photoUrl: agent.photo_url,
    mode: agent.migz_mode,
    setupDone: !!agent.onboarding_completed_at,
    connected: !!agent.meta_ad_account_id,
    slack: !!agent.slack_user_id,
    lastRun: run.data ? { status: run.data.status, at: run.data.finished_at ?? run.data.started_at } : null,
    batch: batchInfo,
    balanceCents: balance,
    today: live && !live.error ? { spendCents: live.today.spendCents, budgetCents: live.today.budgetCents, impressions: live.today.impressions, linkClicks: live.today.linkClicks, bookedCalls: live.today.bookedCalls } : null,
    metaError: live?.error ?? null,
    liveAds: liveAds.count ?? 0,
    alerts: { critical: mine.filter((a) => a.severity === "critical").length, warn: mine.filter((a) => a.severity === "warn").length, info: mine.filter((a) => a.severity === "info").length },
    working,
    adAccount: agent.meta_ad_account_id,
    pageId: agent.meta_page_id,
    instagramId: agent.meta_instagram_id,
    modelBudgetCents: agent.migz_model_budget_cents ?? 3000,
    modelSpentUsd,
  };
}

const SERVICES = [
  { key: "slack", name: "Slack", detail: "Booking alerts, Migz updates and these alerts" },
  { key: "meta", name: "Meta ads", detail: "Lets Migz run and adjust campaigns" },
  { key: "metaPixel", name: "Meta pixel", detail: "Tells Meta which ads book calls" },
  { key: "claude", name: "Claude", detail: "The AI behind Migz's decisions" },
  { key: "higgsfield", name: "Higgsfield", detail: "Generates video creatives" },
  { key: "elevenlabs", name: "ElevenLabs", detail: "Narration and music for videos" },
  { key: "stripe", name: "Stripe", detail: "Adding funds for ads" },
] as const;

export async function getAdminOverview(): Promise<AdminOverview> {
  const since = DateTime.now().minus({ days: RECENT_RESOLVED_DAYS }).toUTC().toISO()!;
  const monthStart = DateTime.now().startOf("month").toUTC().toISO()!;
  const [{ data: agents }, openRes, recentRes, { data: events }, { data: calls }] = await Promise.all([
    supabaseAdmin.from("agents").select("*").eq("active", true).order("full_name"),
    supabaseAdmin.from("admin_alerts").select("*").is("resolved_at", null).order("first_seen", { ascending: false }).limit(200),
    supabaseAdmin.from("admin_alerts").select("*").not("resolved_at", "is", null).gte("resolved_at", since).order("resolved_at", { ascending: false }).limit(40),
    supabaseAdmin.from("migz_events").select("id, agent_id, step, tier, summary, started_at, finished_at").order("id", { ascending: false }).limit(30),
    supabaseAdmin.from("model_calls").select("agent_id, cost_usd").gte("created_at", monthStart),
  ]);
  const spent = new Map<string, number>();
  for (const c of calls ?? []) if (c.agent_id) spent.set(c.agent_id, (spent.get(c.agent_id) ?? 0) + Number(c.cost_usd));
  const list = (agents ?? []) as Agent[];
  const names = new Map(list.map((a) => [a.id, { name: a.full_name, slug: a.slug }]));
  const toAlert = (r: Record<string, unknown>): AdminAlert => ({
    id: r.id as number,
    agentId: (r.agent_id as string | null) ?? null,
    agentName: names.get(r.agent_id as string)?.name ?? "Anryh Labs",
    agentSlug: names.get(r.agent_id as string)?.slug ?? null,
    source: r.source as AdminAlert["source"],
    severity: r.severity as AdminAlert["severity"],
    title: r.title as string,
    detail: (r.detail as string | null) ?? "",
    firstSeen: r.first_seen as string,
    lastSeen: r.last_seen as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
    slackSentAt: (r.slack_sent_at as string | null) ?? null,
  });
  const open = (openRes.data ?? []).map(toAlert);

  // What Migz is doing right now, per agent: its latest step still open (less than half an hour old)
  const fresh = Date.now() - 30 * 60_000;
  const working = new Map<string, string>();
  for (const e of events ?? []) if (!e.finished_at && new Date(e.started_at).getTime() > fresh && !working.has(e.agent_id)) working.set(e.agent_id, e.summary);

  const rows = await Promise.all(list.map((a) => agentRow(a, open, working.get(a.id) ?? null, spent.get(a.id) ?? 0)));
  return {
    at: new Date().toISOString(),
    alertsReady: !openRes.error,
    services: SERVICES.map((s) => ({ ...s, on: integrations[s.key] })),
    agents: rows,
    open,
    recent: (recentRes.data ?? []).map(toAlert),
    activity: (events ?? []).map((e) => ({
      id: e.id,
      agentName: names.get(e.agent_id)?.name ?? "?",
      agentSlug: names.get(e.agent_id)?.slug ?? null,
      step: e.step,
      tier: e.tier,
      summary: e.summary,
      at: e.started_at,
      open: !e.finished_at && new Date(e.started_at).getTime() > fresh,
    })),
    totals: {
      spendTodayCents: rows.reduce((s, r) => s + (r.today?.spendCents ?? 0), 0),
      budgetTodayCents: rows.reduce((s, r) => s + (r.today?.budgetCents ?? 0), 0),
      runningBatches: rows.filter((r) => r.batch).length,
      working: working.size,
    },
  };
}
