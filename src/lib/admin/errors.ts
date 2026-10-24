import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSlackMessage } from "@/lib/slack";
import {
  detailOf,
  issueKey,
  issueSlackMessage,
  MAX_NEW_ALERTS_PER_HOUR,
  REMIND_EVERY_HOURS,
  severityOf,
  shouldIgnore,
  slugOf,
  titleOf,
  type IssueReport,
} from "@/lib/admin/error-core";

// Every error on the site ends up here: one admin alert per distinct problem (the admin dashboard's
// Alerts), and one Slack message to staff the first time it happens, with a reminder if it's still
// happening hours later. Repeats only touch the alert. Never throws: reporting an error must not cause one.

/** On in production; locally only when REPORT_ERRORS=1 (so dev mistakes don't ping anyone). */
export const reportingOn = () => process.env.NODE_ENV === "production" || process.env.REPORT_ERRORS === "1";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

async function ping(report: IssueReport, reminder: boolean) {
  const to = process.env.ANRYH_ALERT_SLACK_ID;
  if (!to || !process.env.SLACK_BOT_TOKEN) return false;
  try {
    const m = issueSlackMessage(report, { appUrl: appUrl(), reminder });
    await sendSlackMessage(to, m.text, m.blocks);
    return true;
  } catch (e) {
    console.error("error alert couldn't reach Slack", e instanceof Error ? e.message : e);
    return false;
  }
}

export type Reported = "off" | "ignored" | "new" | "repeat" | "reminded" | "dropped";

export async function reportIssue(input: IssueReport): Promise<Reported> {
  try {
    if (!reportingOn()) return "off";
    if (shouldIgnore(input)) return "ignored";

    // A booking page error belongs to the agent whose page it is
    let report = input;
    const slug = slugOf(input.path);
    if (!report.agentId && slug) {
      const { data } = await supabaseAdmin.from("agents").select("id, full_name, slug").eq("slug", slug).maybeSingle();
      if (data) report = { ...report, agentId: data.id, agentName: data.full_name, agentSlug: data.slug };
    }

    const key = issueKey(report);
    const now = new Date().toISOString();
    const open = await supabaseAdmin.from("admin_alerts").select("id, slack_sent_at").eq("key", key).is("resolved_at", null).maybeSingle();
    if (open.error) return "off"; // the admin_alerts migration hasn't run

    if (open.data) {
      const last = open.data.slack_sent_at ? new Date(open.data.slack_sent_at).getTime() : 0;
      const remind = Date.now() - last > REMIND_EVERY_HOURS * 3_600_000;
      await supabaseAdmin.from("admin_alerts").update({ last_seen: now, ...(remind ? { slack_sent_at: now } : {}) }).eq("id", open.data.id);
      if (remind) await ping(report, true);
      return remind ? "reminded" : "repeat";
    }

    // A flood of different errors (a bug on every page, or someone poking the endpoint) can't fill the table
    const { count } = await supabaseAdmin
      .from("admin_alerts")
      .select("id", { count: "exact", head: true })
      .like("key", "site_error:%")
      .gte("first_seen", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= MAX_NEW_ALERTS_PER_HOUR) {
      console.error("error alerts: too many new kinds of error this hour, not storing", key);
      return "dropped";
    }

    const { error } = await supabaseAdmin.from("admin_alerts").insert({
      agent_id: report.agentId ?? null,
      key,
      source: "event",
      severity: severityOf(report),
      title: titleOf(report).slice(0, 200),
      detail: detailOf(report),
    });
    if (error?.code === "23505") return "repeat"; // another request stored it a moment ago
    if (error) return "off";
    if (await ping(report, false)) await supabaseAdmin.from("admin_alerts").update({ slack_sent_at: now }).eq("key", key).is("resolved_at", null);
    return "new";
  } catch (e) {
    console.error("couldn't report an error", e instanceof Error ? e.message : e);
    return "off";
  }
}

/** For Next's onRequestError: an error thrown while the server handled a request. */
export async function reportServerError(
  err: unknown,
  request: { path: string; method: string },
  context: { routeType: string },
) {
  const e = err instanceof Error ? err : new Error(String(err));
  await reportIssue({
    kind: "server",
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    message: e.message,
    stack: e.stack?.slice(0, 800) ?? null,
    digest: (err as { digest?: string } | null)?.digest ?? null,
  });
}
