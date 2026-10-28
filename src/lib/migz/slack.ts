import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { recordEventAlert } from "@/lib/admin/alerts";

// Slack alerts for Anryh Labs staff (ANRYH_ALERT_SLACK_ID, a user or channel id) when something broke.
// What the agent hears is in notify.ts.
// Alerts are de-duplicated from migz_events so a failing cron doesn't spam every hour.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  await recordEventAlert({ agentId: agent.id, key: `review_failed:${agent.id}`, severity: "critical", title: "A Migz review failed", detail: message });
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
  await recordEventAlert({ agentId, key: `creative_failed:${jobId}`, severity: "warn", title: "A creative failed", detail: error });
  await alertAdmin(`*A Migz creative failed* for \`${slug}\`\n>${esc(error.slice(0, 400))}\njob \`${jobId.slice(0, 8)}\``);
}

/** New serious audit findings (disapproved ad, tracking down, page down, funding out) go to staff and the agent. */
export async function alertCriticalFindings(agent: Pick<Agent, "id" | "slug" | "slack_user_id">, findings: { severity: string; summary: string; isNew: boolean }[]) {
  const fresh = findings.filter((f) => f.severity === "critical" && f.isNew);
  if (!fresh.length) return;
  const lines = fresh.map((f) => `• ${esc(f.summary)}`).join("\n");
  for (const f of fresh) await recordEventAlert({ agentId: agent.id, key: `finding:${agent.id}:${f.summary.slice(0, 120)}`, severity: "critical", title: "Critical audit finding", detail: f.summary });
  await alertAdmin(`*Critical Migz finding* for \`${agent.slug}\`\n${lines}`);
}
