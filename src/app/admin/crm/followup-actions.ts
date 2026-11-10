"use server";

import { revalidatePath } from "next/cache";
import { isAnryhAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getFollowUpCopy, getSettings } from "@/lib/crm/data";
import { describeOutcome, unsubscribeUrl } from "@/lib/crm/email";
import { blockedReason, CADENCES, firstMorning, followUpEmail, isCadence, isOngoing, nextSendAt, type Cadence } from "@/lib/crm/followups";
import { sendNextFollowUp } from "@/lib/crm/followup-send";
import type { CrmClient } from "@/lib/crm/types";

type Result<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

async function staff() {
  if (!(await isAnryhAdmin())) return null;
  const { data } = await (await createSupabaseServer()).auth.getUser();
  return data.user?.email ?? "staff";
}
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const refresh = (clientId?: string) => {
  revalidatePath("/admin/clients");
  if (clientId) revalidatePath(`/admin/clients/${clientId}`);
};
const migrationError = (e: { message?: string } | null) => !!e && /crm_followups|followup|email_token|unsubscribed_at/.test(e.message ?? "") && /does not exist|schema cache|column/.test(e.message ?? "");
const NEEDS_MIGRATION = "Run migration 20261206000000_crm_follow_up_emails.sql first.";

/**
 * Starts (or restarts) follow-ups for one or more clients. With sendFirstNow, a single client gets the
 * first email right away; for several, the cron sends them within 15 minutes. Otherwise the first one
 * goes the next weekday at 9:00.
 */
export async function startFollowUps(input: { clientIds: string[]; cadence: string; maxEmails: number; sendFirstNow: boolean }): Promise<Result<{ started: number; skipped: number }>> {
  const by = await staff();
  if (!by) return { ok: false, error: "Staff only." };
  if (!isCadence(input.cadence)) return { ok: false, error: "Pick how often." };
  const max = Math.round(Number(input.maxEmails));
  if (!(max >= 1 && max <= 30)) return { ok: false, error: "Emails must be 1 to 30." };
  const ids = [...new Set(input.clientIds)].filter(isUuid).slice(0, 1000);
  if (!ids.length) return { ok: false, error: "Pick at least one client." };

  const [{ data: clients, error }, { data: meetings }, settings] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("*").in("id", ids),
    supabaseAdmin.from("crm_meetings").select("client_id").in("client_id", ids).neq("status", "cancelled").gte("starts_at", new Date().toISOString()),
    getSettings(),
  ]);
  if (migrationError(error)) return { ok: false, error: NEEDS_MIGRATION };
  if (error) return { ok: false, error: "Couldn't read those clients." };
  const withMeeting = new Set((meetings ?? []).map((m) => m.client_id));
  const now = Date.now();
  const ready = (clients as CrmClient[]).filter((c) => !blockedReason(c, withMeeting.has(c.id), input.cadence as Cadence));
  const skipped = ids.length - ready.length;
  if (!ready.length) {
    const why = clients?.length === 1 ? blockedReason(clients[0] as CrmClient, withMeeting.has(clients[0].id), input.cadence as Cadence) : null;
    return { ok: false, error: why ? `Can't start: ${why.toLowerCase()}.` : "None of those clients can get follow-ups (no email, unsubscribed, a meeting coming up, already a client, or lost without the Monthly retainer)." };
  }
  const first = input.sendFirstNow ? new Date(now) : firstMorning(now, settings.timezone);
  const { error: upErr } = await supabaseAdmin.from("crm_followups").upsert(
    ready.map((c) => ({
      client_id: c.id,
      cadence: input.cadence,
      status: "active",
      stop_reason: null,
      max_emails: max,
      sent_count: 0,
      next_send_at: first.toISOString(),
      last_sent_at: null,
      sending_at: null,
      started_by: by,
      updated_at: new Date().toISOString(),
    })),
  );
  if (migrationError(upErr)) return { ok: false, error: NEEDS_MIGRATION };
  if (upErr) return { ok: false, error: "Couldn't start the follow-ups." };

  let message = isOngoing(input.cadence)
    ? `Monthly retainer on for ${ready.length} client${ready.length === 1 ? "" : "s"}: one email a month until they unsubscribe or you stop it.`
    : `Follow-ups on for ${ready.length} client${ready.length === 1 ? "" : "s"}, ${CADENCES[input.cadence].label.toLowerCase()}, up to ${max} emails.`;
  if (input.sendFirstNow && ready.length === 1) {
    const r = await sendNextFollowUp(ready[0].id);
    message = r.ok ? `${describeOutcome(r.outcome, "First follow-up")} The next goes ${isOngoing(input.cadence) ? "in a month" : CADENCES[input.cadence].label.toLowerCase()}.` : `Follow-ups are on, but the first email didn't go: ${r.reason}`;
  } else if (input.sendFirstNow) message += " The first emails go out within 15 minutes.";
  else message += " The first goes the next weekday at 9:00.";
  if (skipped) message += ` Skipped ${skipped} (no email, unsubscribed, a meeting coming up, already a client, or lost without the Monthly retainer).`;
  ready.forEach((c) => refresh(c.id));
  return { ok: true, message, started: ready.length, skipped };
}

export async function setFollowUpState(clientId: string, action: "pause" | "resume" | "stop"): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  if (!isUuid(clientId)) return { ok: false, error: "Unknown client." };
  const now = Date.now();
  const update: Record<string, unknown> = { updated_at: new Date(now).toISOString(), sending_at: null };
  if (action === "pause") Object.assign(update, { status: "paused" });
  if (action === "stop") Object.assign(update, { status: "stopped", stop_reason: "Stopped by staff", next_send_at: null });
  if (action === "resume") {
    const [{ data: f }, settings] = await Promise.all([supabaseAdmin.from("crm_followups").select("cadence, last_sent_at, next_send_at").eq("client_id", clientId).maybeSingle(), getSettings()]);
    if (!f) return { ok: false, error: "No follow-ups for this client." };
    // Pick up where it left off: the time it was due, or the next weekday morning if that's passed
    const due = f.next_send_at && Date.parse(f.next_send_at) > now ? new Date(f.next_send_at) : f.last_sent_at ? nextSendAt(Math.max(Date.parse(f.last_sent_at), now - 86_400_000), f.cadence as Cadence, settings.timezone) : firstMorning(now, settings.timezone);
    Object.assign(update, { status: "active", stop_reason: null, next_send_at: (due.getTime() < now ? firstMorning(now, settings.timezone) : due).toISOString() });
  }
  const { error } = await supabaseAdmin.from("crm_followups").update(update).eq("client_id", clientId);
  if (error) return { ok: false, error: "Couldn't change that." };
  refresh(clientId);
  return { ok: true, message: { pause: "Paused.", resume: "Resumed.", stop: "Stopped." }[action] };
}

export async function changeFollowUp(clientId: string, input: { cadence: string; maxEmails: number }): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  if (!isCadence(input.cadence)) return { ok: false, error: "Pick how often." };
  const max = Math.round(Number(input.maxEmails));
  if (!(max >= 1 && max <= 30)) return { ok: false, error: "Emails must be 1 to 30." };
  const [{ data: f }, settings] = await Promise.all([supabaseAdmin.from("crm_followups").select("*").eq("client_id", clientId).maybeSingle(), getSettings()]);
  if (!f) return { ok: false, error: "No follow-ups for this client." };
  const update: Record<string, unknown> = { cadence: input.cadence, max_emails: max, updated_at: new Date().toISOString() };
  // A new cadence re-times the next email from the last one sent
  if (f.status === "active" && f.last_sent_at) {
    const next = nextSendAt(Date.parse(f.last_sent_at), input.cadence, settings.timezone);
    update.next_send_at = (next.getTime() < Date.now() ? firstMorning(Date.now(), settings.timezone) : next).toISOString();
  }
  if (!isOngoing(input.cadence) && max <= f.sent_count) Object.assign(update, { status: "finished", stop_reason: `All ${max} emails sent`, next_send_at: null });
  else if (f.status === "finished") Object.assign(update, { status: "active", stop_reason: null, next_send_at: (f.last_sent_at ? nextSendAt(Date.parse(f.last_sent_at), input.cadence, settings.timezone) : firstMorning(Date.now(), settings.timezone)).toISOString() });
  const { error } = await supabaseAdmin.from("crm_followups").update(update).eq("client_id", clientId);
  if (error) return { ok: false, error: "Couldn't save that." };
  refresh(clientId);
  return { ok: true, message: "Saved." };
}

export async function sendFollowUpNow(clientId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  if (!isUuid(clientId)) return { ok: false, error: "Unknown client." };
  const r = await sendNextFollowUp(clientId);
  refresh(clientId);
  return r.ok ? { ok: true, message: describeOutcome(r.outcome, `Follow-up #${r.step}`) } : { ok: false, error: r.reason };
}

/** The email as it would go out: for a client (their name and company), or a sample. */
export async function previewFollowUp(input: { clientId?: string | null; step: number; total: number; cadence?: string; copy?: { offer: string; process: string; ctaUrl: string; ctaLabel: string; postalAddress: string } }): Promise<Result<{ subject: string; html: string }>> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const [settings, saved] = await Promise.all([getSettings(), getFollowUpCopy()]);
  let client = { name: "Alex Rivera", company: "Rivera Roofing" } as { name: string | null; company: string | null };
  if (input.clientId && isUuid(input.clientId)) {
    const { data } = await supabaseAdmin.from("crm_clients").select("name, company").eq("id", input.clientId).maybeSingle();
    if (data) client = data;
  }
  const copy = input.copy
    ? { offer: input.copy.offer.trim() || saved.offer, process: input.copy.process.trim() || saved.process, ctaUrl: input.copy.ctaUrl.trim() || null, ctaLabel: input.copy.ctaLabel.trim() || saved.ctaLabel, postalAddress: input.copy.postalAddress.trim() || null }
    : saved;
  const step = Math.max(1, Math.min(30, Math.round(input.step)));
  const total = Math.max(step, Math.min(30, Math.round(input.total)));
  const e = followUpEmail({ step, total, cadence: isCadence(input.cadence) ? input.cadence : undefined, from: settings.from_name, client, copy, unsubscribeUrl: unsubscribeUrl("preview") });
  return { ok: true, subject: e.subject, html: e.html };
}

export async function saveFollowUpCopy(input: { offer: string; process: string; ctaUrl: string; ctaLabel: string; postalAddress: string }): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  let ctaUrl = input.ctaUrl.trim().slice(0, 1000) || null;
  if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) ctaUrl = `https://${ctaUrl}`;
  if (ctaUrl) {
    try {
      new URL(ctaUrl);
    } catch {
      return { ok: false, error: "That button link doesn't look right." };
    }
  }
  const { error } = await supabaseAdmin.from("crm_settings").upsert({
    id: true,
    followup_offer: input.offer.trim().slice(0, 4000) || null,
    followup_process: input.process.trim().slice(0, 3000) || null,
    followup_cta_url: ctaUrl,
    followup_cta_label: input.ctaLabel.trim().slice(0, 60) || null,
    postal_address: input.postalAddress.trim().slice(0, 300) || null,
    updated_at: new Date().toISOString(),
  });
  if (migrationError(error)) return { ok: false, error: NEEDS_MIGRATION };
  if (error) return { ok: false, error: "Couldn't save the email." };
  refresh();
  return { ok: true, message: "Saved." };
}
