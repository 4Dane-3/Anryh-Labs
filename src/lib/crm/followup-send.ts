import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getFollowUpCopy, getSettings } from "@/lib/crm/data";
import { sendFollowUpEmail, unsubscribeUrl, type SendOutcome } from "@/lib/crm/email";
import { blockedReason, followUpEmail, isOngoing, nextSendAt, type CrmFollowUp } from "@/lib/crm/followups";
import type { CrmClient } from "@/lib/crm/types";

// Sends a client's next follow-up email: used by the every-15-minutes cron (what's due) and by staff's
// "Send the next one now". Claims the row first (sending_at) so overlapping runs can't double-send.

const CLAIM_STALE_MS = 10 * 60_000;
const RETRY_MS = 60 * 60_000;

export type FollowUpResult = { ok: true; outcome: SendOutcome; step: number } | { ok: false; reason: string };

async function stop(clientId: string, reason: string, status: "stopped" | "finished" = "stopped") {
  await supabaseAdmin.from("crm_followups").update({ status, stop_reason: reason, next_send_at: null, sending_at: null, updated_at: new Date().toISOString() }).eq("client_id", clientId);
}

export async function sendNextFollowUp(clientId: string, opts: { due?: boolean } = {}): Promise<FollowUpResult> {
  const now = Date.now();
  // Claim: active, not being sent by another run, and (for the cron) due
  let q = supabaseAdmin
    .from("crm_followups")
    .update({ sending_at: new Date(now).toISOString() })
    .eq("client_id", clientId)
    .eq("status", "active")
    .or(`sending_at.is.null,sending_at.lt.${new Date(now - CLAIM_STALE_MS).toISOString()}`);
  if (opts.due) q = q.lte("next_send_at", new Date(now).toISOString());
  const { data: claimed } = await q.select("*").maybeSingle();
  const f = claimed as (CrmFollowUp & { sending_at: string }) | null;
  if (!f) return { ok: false, reason: "Nothing to send: the sequence isn't active, or an email is already going out." };

  const [{ data: client }, { data: upcoming }, settings, copy] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("*").eq("id", clientId).maybeSingle(),
    supabaseAdmin.from("crm_meetings").select("id").eq("client_id", clientId).neq("status", "cancelled").gte("starts_at", new Date(now).toISOString()).limit(1),
    getSettings(),
    getFollowUpCopy(),
  ]);
  const c = client as CrmClient | null;
  if (!c) return { ok: false, reason: "That client is gone." };
  const blocked = blockedReason(c, (upcoming ?? []).length > 0, f.cadence);
  if (blocked) {
    await stop(clientId, blocked);
    return { ok: false, reason: `Stopped: ${blocked.toLowerCase()}.` };
  }

  const step = f.sent_count + 1;
  const email = followUpEmail({ step, total: f.max_emails, cadence: f.cadence, from: settings.from_name, client: c, copy, unsubscribeUrl: unsubscribeUrl(c.email_token!) });
  let outcome: SendOutcome;
  try {
    outcome = await sendFollowUpEmail({ clientId, step, to: c.email!, token: c.email_token!, email, settings });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("crm_followup_emails").insert({ client_id: clientId, step, subject: email.subject, to_email: c.email!, outcome: "failed", error: error.slice(0, 500) });
    // Try again in an hour; the claim is released
    await supabaseAdmin.from("crm_followups").update({ sending_at: null, next_send_at: new Date(now + RETRY_MS).toISOString(), updated_at: new Date().toISOString() }).eq("client_id", clientId);
    return { ok: false, reason: `The email didn't go: ${error}` };
  }
  if ("skipped" in outcome) {
    await supabaseAdmin.from("crm_followups").update({ sending_at: null, updated_at: new Date().toISOString() }).eq("client_id", clientId);
    return { ok: false, reason: outcome.reason };
  }

  await supabaseAdmin.from("crm_followup_emails").insert({ client_id: clientId, step, subject: email.subject, to_email: "sent" in outcome ? outcome.to : c.email!, outcome: "sent" in outcome ? "sent" : "logged" });
  const done = !isOngoing(f.cadence) && step >= f.max_emails;
  await supabaseAdmin
    .from("crm_followups")
    .update({
      sent_count: step,
      last_sent_at: new Date(now).toISOString(),
      next_send_at: done ? null : nextSendAt(now, f.cadence, settings.timezone).toISOString(),
      status: done ? "finished" : "active",
      stop_reason: done ? `All ${f.max_emails} emails sent` : null,
      sending_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);
  // A first email moves a fresh lead to "Contacted"
  if (c.status === "lead") await supabaseAdmin.from("crm_clients").update({ status: "contacted", updated_at: new Date().toISOString() }).eq("id", clientId);
  return { ok: true, outcome, step };
}

/** The cron's part: every active sequence that's due, oldest first, a batch at a time. */
export async function runDueFollowUps(limit = 40) {
  const { data, error } = await supabaseAdmin
    .from("crm_followups")
    .select("client_id")
    .eq("status", "active")
    .lte("next_send_at", new Date().toISOString())
    .order("next_send_at")
    .limit(limit);
  if (error) {
    if (/crm_followups/.test(error.message) && /does not exist|schema cache/.test(error.message)) return { due: 0, sent: 0, skipped: "migration not run" };
    throw new Error(`follow-ups: ${error.message}`);
  }
  let sent = 0;
  for (const row of data ?? []) {
    const r = await sendNextFollowUp(row.client_id, { due: true });
    if (r.ok) sent++;
  }
  return { due: data?.length ?? 0, sent };
}
