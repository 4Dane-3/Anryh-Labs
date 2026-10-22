import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";

// Slack for Migz, in two voices:
//  - the agent: a "what Migz did" section in their morning digest (live updates are in notify.ts)
//  - Anryh Labs staff (ANRYH_ALERT_SLACK_ID, a user or channel id): alerts when something broke
// Alerts are de-duplicated from migz_events so a failing cron doesn't spam every hour.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function alertAdmin(text: string) {
  const to = process.env.ANRYH_ALERT_SLACK_ID;
  if (!to || !process.env.SLACK_BOT_TOKEN) return false;
  try {
    await sendSlackMessage(to, `:rotating_light: ${text}`);
    return true;
  } catch {
    return false;
  }
}

/** True the first time a given alert key shows up in the last `hours` hours; records it for next time. */
export async function firstAlertSince(agentId: string, key: string, hours = 6) {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("migz_events")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("step", "finished")
    .eq("summary", key.slice(0, 400))
    .gte("started_at", since);
  return (count ?? 0) === 0;
}

/** A review failed: tell staff once per distinct error per window. */
export async function alertReviewFailed(agent: Pick<Agent, "id" | "slug">, message: string, runId: string) {
  const key = `Review failed: ${message.slice(0, 200)}`;
  if (!(await firstAlertSince(agent.id, key))) return;
  await alertAdmin(`*Migz review failed* for \`${agent.slug}\`\n>${esc(message.slice(0, 400))}\nrun \`${runId.slice(0, 8)}\` · see the Brain page for the step log`);
}

/** A creative couldn't be made or launched. */
export async function alertCreativeFailed(agentId: string, slug: string, jobId: string, error: string) {
  const key = `Creative failed: ${error.slice(0, 200)}`;
  if (!(await firstAlertSince(agentId, key, 12))) return;
  await supabaseAdmin.from("migz_events").insert({
    agent_id: agentId, run_id: null, step: "finished", tier: "code", summary: key.slice(0, 400), evidence: { job_id: jobId },
    finished_at: new Date().toISOString(),
  });
  await alertAdmin(`*A Migz creative failed* for \`${slug}\`\n>${esc(error.slice(0, 400))}\njob \`${jobId.slice(0, 8)}\``);
}

/** New serious audit findings (disapproved ad, tracking down, page down, funding out) go to staff and the agent. */
export async function alertCriticalFindings(agent: Pick<Agent, "id" | "slug" | "slack_user_id">, findings: { severity: string; summary: string; isNew: boolean }[]) {
  const fresh = findings.filter((f) => f.severity === "critical" && f.isNew);
  if (!fresh.length) return;
  const lines = fresh.map((f) => `• ${esc(f.summary)}`).join("\n");
  await alertAdmin(`*Critical Migz finding* for \`${agent.slug}\`\n${lines}`);
}

/** The "what Migz did" block for the morning digest: yesterday's results, actions and anything waiting. */
export async function migzDigestSection(agent: Agent, now: DateTime) {
  if (!agent.meta_ad_account_id || agent.migz_mode === "off") return "";
  const dayStart = now.startOf("day").minus({ days: 1 });
  const since = dayStart.toUTC().toISO()!;
  const [{ data: metric }, { data: actions }, { data: waiting }, { data: findings }, { data: bookings }] = await Promise.all([
    supabaseAdmin.from("ad_metrics_daily").select("spend_cents, impressions, clicks").eq("agent_id", agent.id).eq("date", dayStart.toISODate()!).maybeSingle(),
    supabaseAdmin.from("ad_actions").select("title, status").eq("agent_id", agent.id).gte("created_at", since).in("status", ["applied", "failed"]).neq("tool", "system_setup").order("created_at"),
    supabaseAdmin.from("ad_actions").select("title").eq("agent_id", agent.id).eq("status", "proposed"),
    supabaseAdmin.from("audit_findings").select("summary, severity").eq("agent_id", agent.id).eq("status", "open").in("severity", ["critical", "warn"]).limit(3),
    supabaseAdmin.from("bookings").select("id, attribution").eq("agent_id", agent.id).gte("created_at", since).lt("created_at", now.startOf("day").toUTC().toISO()!),
  ]);
  const fromAds = (bookings ?? []).filter((b) => (b.attribution as Record<string, string> | null)?.utm_source === "meta").length;
  const lines: string[] = [`:chart_with_upwards_trend: *Your ads yesterday*`];
  if (metric && (metric.spend_cents || metric.impressions))
    lines.push(`${usd(metric.spend_cents)} spent · ${metric.impressions.toLocaleString("en-US")} impressions · ${metric.clicks} clicks · ${fromAds} call${fromAds === 1 ? "" : "s"} booked from ads`);
  else lines.push("No ad results yet.");
  if (actions?.length) {
    lines.push(`*What Migz did:*`);
    for (const a of actions.slice(0, 6)) lines.push(`• ${a.status === "failed" ? "(didn't go through) " : ""}${esc(a.title)}`);
  } else lines.push("Migz made no changes. Holding steady is often the right call.");
  if (waiting?.length) lines.push(`*Waiting for your OK (${waiting.length}):* ${waiting.slice(0, 3).map((w) => esc(w.title)).join("; ")}`);
  if (findings?.length) lines.push(`*Needs attention:* ${findings.map((f) => esc(f.summary)).join(" ")}`);
  return lines.join("\n");
}
