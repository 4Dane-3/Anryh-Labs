import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { graph, graphAll } from "@/lib/meta/graph";
import { getActiveBatch, getBatchProgress } from "@/lib/dashboard/batches";
import { monthlyBudget } from "@/lib/migz/router";
import { isTestMode } from "@/lib/migz/test-mode";
import { briefLabel, type AnyBrief } from "@/lib/migz/brief";
import { sendSlackMessage } from "@/lib/slack";
import { findIssues, type HealthInput, type Issue, type Severity } from "@/lib/admin/issues";

// The admin dashboard's watchman. Every 10 minutes (creatives cron) it checks each agent's account in
// Meta and in our tables, opens an alert for each new problem, closes the ones that went away, and pings
// staff in Slack once per new problem. Failures Migz reports as they happen (a review or creative that
// failed) are recorded here too (recordEventAlert), so the admin page has the whole picture.

const EVENT_TTL_HOURS = 72; // a one-off failure with no newer sign of trouble closes itself after this
const SNOOZE_HOURS = 24; // a problem staff marked handled doesn't re-alert for this long

type Row = { id: number; key: string; source: string; resolved_at: string | null; resolved_by: string | null; first_seen: string };

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ICON: Record<Severity, string> = { critical: ":red_circle:", warn: ":large_orange_circle:", info: ":white_circle:" };

/** Everything findIssues needs about one agent. Meta errors are part of the answer, never thrown. */
export async function gatherHealth(agent: Agent, now = Date.now()): Promise<HealthInput> {
  const zone = agent.timezone;
  const today = DateTime.fromMillis(now).setZone(zone).startOf("day");
  const account = agent.meta_ad_account_id;

  const [campaignRows, adsetRows, adRows, run, jobs, proposals, budget, batch] = await Promise.all([
    supabaseAdmin.from("ad_campaigns").select("meta_campaign_id, retired_at").eq("agent_id", agent.id),
    supabaseAdmin.from("ad_sets").select("meta_adset_id, ad_campaigns(retired_at)").eq("agent_id", agent.id),
    supabaseAdmin.from("ads").select("meta_ad_id").eq("agent_id", agent.id),
    supabaseAdmin.from("migz_runs").select("status, started_at, error").eq("agent_id", agent.id).neq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("creative_jobs").select("id, stage, updated_at, brief, launch_adset_id").eq("agent_id", agent.id).in("stage", ["generating", "meta_processing", "stored"]),
    supabaseAdmin.from("ad_actions").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("status", "proposed").lt("created_at", new Date(now - 86_400_000).toISOString()),
    monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000),
    getActiveBatch(agent.id),
  ]);

  const ours = {
    campaigns: new Map((campaignRows.data ?? []).map((c) => [c.meta_campaign_id, !!c.retired_at])),
    adsets: new Map((adsetRows.data ?? []).map((s) => [s.meta_adset_id, !!(s.ad_campaigns as { retired_at?: string | null } | null)?.retired_at])),
    ads: new Set((adRows.data ?? []).map((a) => a.meta_ad_id)),
  };

  let meta: HealthInput["meta"] = null;
  let spend = { todayCents: 0, yesterdayCents: 0 };
  if (account) {
    try {
      type T = { id: string; name: string; effective_status: string };
      const [acct, campaigns, adsets, ads, days] = await Promise.all([
        graph<{ account_status?: number }>("GET", account, { fields: "account_status" }),
        graphAll<T>(`${account}/campaigns`, { fields: "id,name,effective_status", limit: 200 }),
        graphAll<T>(`${account}/adsets`, { fields: "id,name,effective_status", limit: 200 }),
        graphAll<T & { ad_review_feedback?: { global?: Record<string, string> } }>(`${account}/ads`, { fields: "id,name,effective_status,ad_review_feedback", limit: 500 }),
        graphAll<{ spend?: string; date_start: string }>(`${account}/insights`, {
          level: "account",
          time_increment: 1,
          time_range: { since: today.minus({ days: 1 }).toISODate(), until: today.toISODate() },
          fields: "spend",
        }),
      ]);
      meta = {
        error: null,
        accountStatus: acct.account_status ?? null,
        campaigns: campaigns.filter((c) => ours.campaigns.has(c.id)).map((c) => ({ ...c, name: c.name.replace(/^Migz · /, ""), retired: ours.campaigns.get(c.id)! })),
        adsets: adsets.filter((s) => ours.adsets.has(s.id)).map((s) => ({ ...s, retired: ours.adsets.get(s.id)! })),
        ads: ads
          .filter((x) => ours.ads.has(x.id))
          .map((x) => ({ id: x.id, name: x.name.replace(/^Migz · /, ""), effective_status: x.effective_status, reviewFeedback: Object.values(x.ad_review_feedback?.global ?? {})[0] ?? null })),
      };
      const by = new Map(days.map((d) => [d.date_start, Math.round(Number(d.spend ?? 0) * 100)]));
      spend = { todayCents: by.get(today.toISODate()!) ?? 0, yesterdayCents: by.get(today.minus({ days: 1 }).toISODate()!) ?? 0 };
    } catch (e) {
      meta = { error: e instanceof Error ? e.message : String(e), accountStatus: null, campaigns: [], adsets: [], ads: [] };
    }
  }

  let batchInfo: HealthInput["batch"] = null;
  if (batch?.starts_on && batch.starts_on <= today.toISODate()!) {
    const p = await getBatchProgress(agent, batch);
    batchInfo = { day: Math.min(p.day, batch.days), days: batch.days, budgetCents: batch.budget_cents, spentCents: p.spentCents };
  }

  return {
    agent: {
      id: agent.id,
      slug: agent.slug,
      name: agent.full_name,
      mode: agent.migz_mode,
      setupDone: !!agent.onboarding_completed_at,
      adAccount: account,
      slack: !!agent.slack_user_id,
      lastRunAt: agent.migz_last_run_at,
    },
    now,
    testMode: isTestMode(),
    lastRun: run.data ?? null,
    batch: batchInfo,
    meta,
    spend,
    jobs: (jobs.data ?? [])
      .filter((j) => j.stage !== "stored" || j.launch_adset_id) // a stored library creative isn't waiting on anything
      .map((j) => ({ id: j.id, stage: j.stage, updated_at: j.updated_at, brief: briefLabel(j.brief as AnyBrief) })),
    modelBudgetRatio: budget.ratio,
    staleProposals: proposals.count ?? 0,
  };
}

/** True once the admin_alerts migration has run. */
async function alertsReady() {
  const { error } = await supabaseAdmin.from("admin_alerts").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}

/**
 * Brings one agent's scan alerts in line with what's true now. Returns the problems that are new (not
 * already open, and not marked handled by staff in the last day).
 */
async function saveScan(agentId: string, issues: Issue[], lastRunOk: boolean) {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from("admin_alerts")
    .select("id, key, source, resolved_at, resolved_by, first_seen")
    .eq("agent_id", agentId)
    .or(`resolved_at.is.null,resolved_at.gte.${new Date(Date.now() - SNOOZE_HOURS * 3_600_000).toISOString()}`);
  const all = (rows ?? []) as Row[];
  const open = new Map(all.filter((r) => !r.resolved_at && r.source === "scan").map((r) => [r.key, r]));
  const snoozed = new Set(all.filter((r) => r.resolved_at && r.resolved_by && r.resolved_by !== "auto").map((r) => r.key));
  const fresh: Issue[] = [];

  for (const issue of issues) {
    const existing = open.get(issue.key);
    if (existing) {
      await supabaseAdmin.from("admin_alerts").update({ last_seen: nowIso, title: issue.title, detail: issue.detail, severity: issue.severity }).eq("id", existing.id);
      open.delete(issue.key);
    } else if (!snoozed.has(issue.key)) {
      const { error } = await supabaseAdmin.from("admin_alerts").insert({ agent_id: agentId, key: issue.key, source: "scan", severity: issue.severity, title: issue.title, detail: issue.detail });
      if (!error) fresh.push(issue);
    }
  }
  // Gone: the problem was fixed (in Meta, by Migz, or by the agent)
  if (open.size) await supabaseAdmin.from("admin_alerts").update({ resolved_at: nowIso, resolved_by: "auto" }).in("id", [...open.values()].map((r) => r.id));

  // One-off failures close once things are healthy again: a review failure when a later review worked,
  // anything else after a few days
  const stale = all.filter((r) => !r.resolved_at && r.source === "event" && ((lastRunOk && r.key.startsWith("event:review_failed:")) || Date.now() - new Date(r.first_seen).getTime() > EVENT_TTL_HOURS * 3_600_000));
  if (stale.length) await supabaseAdmin.from("admin_alerts").update({ resolved_at: nowIso, resolved_by: "auto" }).in("id", stale.map((r) => r.id));
  return fresh;
}

/** Pings staff (ANRYH_ALERT_SLACK_ID) once about new problems, grouped into one message per scan. */
async function pingStaff(fresh: { agent: { slug: string; name: string }; issue: Issue }[]) {
  const to = process.env.ANRYH_ALERT_SLACK_ID;
  const worth = fresh.filter((f) => f.issue.severity !== "info");
  if (!worth.length || !to || !process.env.SLACK_BOT_TOKEN) return false;
  const lines = worth.slice(0, 12).map((f) => `${ICON[f.issue.severity]} *${esc(f.agent.name)}*: ${esc(f.issue.title)}\n>${esc(f.issue.detail.slice(0, 240))}`);
  const more = worth.length > 12 ? `\n…and ${worth.length - 12} more` : "";
  const title = `Migz spotted ${worth.length === 1 ? "a new problem" : `${worth.length} new problems`}`;
  try {
    await sendSlackMessage(to, title, [
      { type: "header", text: { type: "plain_text", text: `:rotating_light: ${title}`, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: (lines.join("\n\n") + more).slice(0, 2900) } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open the admin dashboard" }, url: `${appUrl()}/admin`, style: "primary" }] },
    ]);
    const keys = worth.map((f) => f.issue.key);
    await supabaseAdmin.from("admin_alerts").update({ slack_sent_at: new Date().toISOString() }).in("key", keys).is("resolved_at", null);
    return true;
  } catch (e) {
    console.error("admin slack ping failed", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Scans every active agent (until the deadline), saves the alerts and pings staff about new ones. */
export async function scanAll(deadlineMs: number) {
  if (!(await alertsReady())) return { skipped: "admin_alerts migration not run" };
  const { data: agents } = await supabaseAdmin.from("agents").select("*").eq("active", true).order("created_at");
  const fresh: { agent: { slug: string; name: string }; issue: Issue }[] = [];
  const results: Record<string, number> = {};
  for (const agent of (agents ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    try {
      const input = await gatherHealth(agent);
      const issues = findIssues(input);
      const added = await saveScan(agent.id, issues, input.lastRun?.status === "succeeded");
      for (const issue of added) fresh.push({ agent: { slug: agent.slug, name: agent.full_name }, issue });
      results[agent.slug] = issues.length;
    } catch (e) {
      console.error("health scan failed", agent.slug, e instanceof Error ? e.message : e);
    }
  }
  const pinged = await pingStaff(fresh);
  return { agents: results, new: fresh.length, pinged };
}
