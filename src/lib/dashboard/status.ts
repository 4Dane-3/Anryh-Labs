import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getActiveBatch, getBatchProgress } from "@/lib/dashboard/batches";
import { REVISE_AFTER_DAYS } from "@/lib/campaign";
import { REVIEW_EVERY_HOURS } from "@/lib/migz/brain";

// "What's Migz doing right now?" for the Overview, read straight from the account. No model call and no
// changes: agents get an update without starting a review (which would make new creatives).

export type MigzUpdate = {
  headline: string; // e.g. "Day 2 of 14 · Collecting results"
  detail: string;
  lines: string[];
  lastCheck: { at: string; summary: string | null } | null;
  nextCheckAt: string | null;
};

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export async function getMigzUpdate(agent: Agent): Promise<MigzUpdate> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [batch, jobs, ads, proposals, lastRun] = await Promise.all([
    getActiveBatch(agent.id),
    supabaseAdmin
      .from("creative_jobs")
      .select("stage, launch_adset_id")
      .eq("agent_id", agent.id)
      .in("stage", ["generating", "stored", "meta_processing"]),
    supabaseAdmin
      .from("ads")
      // Live means Meta can deliver it: the ad, its ad set and its campaign all switched on (an ad left
      // on inside a paused ad set doesn't show)
      .select("meta_ad_id, status, created_at, ad_sets!inner(status, ad_campaigns!inner(status, retired_at))")
      .eq("agent_id", agent.id)
      .eq("status", "ACTIVE")
      .eq("ad_sets.status", "ACTIVE")
      .eq("ad_sets.ad_campaigns.status", "ACTIVE")
      .is("ad_sets.ad_campaigns.retired_at", null),
    supabaseAdmin.from("ad_actions").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("status", "proposed"),
    supabaseAdmin.from("migz_runs").select("started_at, finished_at, status, summary").eq("agent_id", agent.id).neq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const lines: string[] = [];
  let headline = "No campaign batch running";
  let detail = "Start a campaign batch at the top of this page and Migz takes it from there.";

  if (batch?.starts_on) {
    const progress = await getBatchProgress(agent, batch);
    const day = Math.min(progress.day, batch.days);
    const revisionsFrom = DateTime.fromISO(batch.starts_on, { zone: agent.timezone }).plus({ days: REVISE_AFTER_DAYS });
    const collecting = DateTime.now().setZone(agent.timezone) < revisionsFrom;
    headline = `Day ${day} of ${batch.days} · ${collecting ? "Collecting results" : "Revising"}`;
    detail = collecting
      ? `Migz is letting your ads gather a full week of data. It won't change budgets or pause ads until ${revisionsFrom.toFormat("cccc, LLL d")}, so its decisions rest on real results.`
      : "Migz is comparing your campaigns and fixing what's underperforming, then checking that each change actually helps.";
    lines.push(`${money(progress.spentCents)} of your ${money(batch.budget_cents)} batch spent · ${progress.bookedCalls} booked call${progress.bookedCalls === 1 ? "" : "s"} so far (spend updates hourly; Meta itself can run a few hours behind)`);
  }

  const live = ads.data ?? [];
  if (live.length) {
    const fresh = live.filter((a) => a.created_at >= dayAgo).length;
    lines.push(
      `${live.length} ad${live.length === 1 ? "" : "s"} live${fresh ? ` (${fresh} new today: Meta reviews new ads first, usually within a few hours, before they start showing)` : ""}`,
    );
  }
  const making = (jobs.data ?? []).filter((j) => j.stage === "generating").length;
  const building = (jobs.data ?? []).filter((j) => j.stage !== "generating" && j.launch_adset_id).length;
  if (making) lines.push(`${making} creative${making === 1 ? "" : "s"} being made`);
  if (building) lines.push(`${building} ad${building === 1 ? "" : "s"} being built in Meta`);
  if (proposals.count) lines.push(`${proposals.count} change${proposals.count === 1 ? "" : "s"} waiting for your OK`);

  // Reviews are checked hourly and run at most every few hours
  const lastAt = agent.migz_last_run_at ? DateTime.fromISO(agent.migz_last_run_at) : null;
  const next = agent.migz_mode === "off" || !agent.onboarding_completed_at
    ? null
    : lastAt
      ? DateTime.max(lastAt.plus({ hours: REVIEW_EVERY_HOURS }), DateTime.now().plus({ hours: 1 }).startOf("hour"))
      : DateTime.now().plus({ hours: 1 }).startOf("hour");

  return {
    headline,
    detail,
    lines,
    lastCheck: lastRun.data ? { at: lastRun.data.finished_at ?? lastRun.data.started_at, summary: lastRun.data.summary } : null,
    nextCheckAt: next?.toISO() ?? null,
  };
}
