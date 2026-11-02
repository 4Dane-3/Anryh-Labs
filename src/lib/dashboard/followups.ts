import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendFollowUpEmail } from "@/lib/booking/email";
import { MAX_FOLLOWUPS } from "@/lib/booking/lead-email";
import { leadEmailSender } from "@/lib/booking/sites";
import { logActivity } from "@/lib/dashboard/activity";

// The 48-hour follow-ups: when the agent has follow-up emails on, a lead they haven't reached gets up to
// MAX_FOLLOWUPS short notes, each at least 48 hours after the last email it got (the instant thank-you, a
// "sorry I missed you", or the previous follow-up). Kept gentle so it reads like a person and stays out of
// spam: daytime only in the agent's timezone, a few per run, and it stops the moment the lead books, is
// reached, sold or marked not interested (or moves to current plan). Leads older than 14 days are left alone.

export const FOLLOWUP_GAP_HOURS = 48;
const FOLLOWUP_WINDOW_DAYS = 14;
/** Local hours follow-ups go out in (9am to before 6pm), like a person writing during the workday. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 18;
/** Per agent per hourly run, so a backlog trickles out instead of landing all at once. */
const MAX_PER_RUN = 10;

type DueLead = { id: string; name: string; email: string; source: string | null; followups_sent: number; last_emailed_at: string | null; created_at: string };

/** Whether a lead is due its next follow-up now (pure, for the tests). */
export function followUpDue(lead: Pick<DueLead, "followups_sent" | "last_emailed_at" | "created_at">, now: DateTime) {
  if (lead.followups_sent >= MAX_FOLLOWUPS) return false;
  if (DateTime.fromISO(lead.created_at) < now.minus({ days: FOLLOWUP_WINDOW_DAYS })) return false;
  // Never emailed at all (no email at the time, or sending was off): count from when they came in
  return DateTime.fromISO(lead.last_emailed_at ?? lead.created_at) <= now.minus({ hours: FOLLOWUP_GAP_HOURS });
}

/** Sends the follow-ups that are due for one agent. Returns how many went out. */
export async function sendDueFollowUps(agent: Agent, now: DateTime = DateTime.now()) {
  if (!agent.followup_emails || !process.env.RESEND_API_KEY || !leadEmailSender(agent.slug)) return 0;
  const local = now.setZone(agent.timezone);
  if (local.hour < SEND_FROM_HOUR || local.hour >= SEND_UNTIL_HOUR) return 0;

  const { data, error } = await supabaseAdmin
    .from("quote_requests")
    .select("id, name, email, source, followups_sent, last_emailed_at, created_at")
    .eq("agent_id", agent.id)
    .eq("client_status", "prospect")
    .not("email", "is", null)
    .is("booked_at", null)
    // Unanswered, or the agent tried and couldn't reach them; anything else means they talked
    .or("outcome.is.null,outcome.eq.not_reached")
    .lt("followups_sent", MAX_FOLLOWUPS)
    .gte("created_at", now.minus({ days: FOLLOWUP_WINDOW_DAYS }).toUTC().toISO()!)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return 0;

  let sent = 0;
  for (const lead of ((data ?? []) as DueLead[]).filter((l) => followUpDue(l, now) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)).slice(0, MAX_PER_RUN)) {
    const n = lead.followups_sent + 1;
    // Claim it first, so two overlapping runs can't both send the same follow-up
    const { data: claimed } = await supabaseAdmin
      .from("quote_requests")
      .update({ followups_sent: n, last_emailed_at: now.toUTC().toISO() })
      .eq("id", lead.id)
      .eq("followups_sent", lead.followups_sent)
      .select("id");
    if (!claimed?.length) continue;
    try {
      const res = await sendFollowUpEmail({ agent, leadId: lead.id, n, via: lead.source === "instant_form" ? "instant_form" : "page", prospect: { name: lead.name, email: lead.email } });
      if (res.skipped) throw new Error("sending is off");
      await logActivity(agent.id, { kind: "lead", id: lead.id }, "email", `Follow-up ${n} of ${MAX_FOLLOWUPS}`);
      sent++;
    } catch (e) {
      // Give the claim back so the next run retries
      await supabaseAdmin.from("quote_requests").update({ followups_sent: lead.followups_sent, last_emailed_at: lead.last_emailed_at }).eq("id", lead.id);
      console.error("follow-up email failed", agent.slug, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
