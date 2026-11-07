import { isCronRequest } from "@/lib/cron-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSettings } from "@/lib/crm/data";
import { sendMeetingEmail } from "@/lib/crm/email";
import type { InviteKind } from "@/lib/crm/invite-email";
import type { CrmMeeting, CrmSettings } from "@/lib/crm/types";

export const maxDuration = 60;

const MIN = 60_000;
const HOUR = 60 * MIN;

type Job = {
  kind: InviteKind;
  /** The timestamp column that claims the send, so it goes out once per invite (or per meeting time) */
  claim: "nudge_sent_at" | "reminder_sent_at" | "hour_reminder_sent_at";
  statuses: CrmMeeting["status"][];
  startsAfter: number; // ms from now
  startsBy: number; // ms from now
  invitedBefore: number; // ms before now
};

// Every 15 minutes (pg_cron), the CRM's automatic emails to clients. Email only for now; a texting
// provider would add its own claim column and send next to each of these.
const JOBS: Job[] = [
  // 4 hours after the invite, still unconfirmed: "just checking this reached you", with the Confirm
  // button. Not when the meeting is within 6 hours (the reminders cover that).
  { kind: "nudge", claim: "nudge_sent_at", statuses: ["invited"], startsAfter: 6 * HOUR, startsBy: 365 * 24 * HOUR, invitedBefore: 4 * HOUR },
  // The day before: within 24 hours of the start, unless the invite went out in the last 6 hours (it's
  // fresh in their inbox) or the hour-before reminder is about to go.
  { kind: "reminder", claim: "reminder_sent_at", statuses: ["invited", "confirmed"], startsAfter: 90 * MIN, startsBy: 24 * HOUR, invitedBefore: 6 * HOUR },
  // An hour before, with the link: "we're on at 10:00, running late? just reply". The window is wider
  // than the cron's 15 minutes so a late run still catches it.
  { kind: "hour", claim: "hour_reminder_sent_at", statuses: ["invited", "confirmed"], startsAfter: 20 * MIN, startsBy: 65 * MIN, invitedBefore: 30 * MIN },
];

type Row = CrmMeeting & { client: { name: string | null; email: string | null } };

async function runJob(job: Job, now: number, settings: CrmSettings) {
  const { data, error } = await supabaseAdmin
    .from("crm_meetings")
    .select("*, client:crm_clients(name, company, email)")
    .in("status", job.statuses)
    .is("outcome", null)
    .is(job.claim, null)
    .gt("starts_at", new Date(now + job.startsAfter).toISOString())
    .lte("starts_at", new Date(now + job.startsBy).toISOString())
    .lt("invited_at", new Date(now - job.invitedBefore).toISOString());
  if (error) throw new Error(`${job.kind}: ${error.message}`);
  let sent = 0;
  for (const m of (data ?? []) as Row[]) {
    if (!m.client.email) continue;
    // Claim it first so an overlapping run can't send it twice
    const { data: claimed } = await supabaseAdmin
      .from("crm_meetings")
      .update({ [job.claim]: new Date().toISOString() })
      .eq("id", m.id)
      .is(job.claim, null)
      .in("status", job.statuses)
      .select("*")
      .maybeSingle();
    if (!claimed) continue;
    try {
      await sendMeetingEmail({ kind: job.kind, meeting: claimed as CrmMeeting, client: { name: m.client.name, email: m.client.email }, settings });
      sent++;
    } catch (e) {
      console.error(`crm ${job.kind} failed`, m.id, e);
      await supabaseAdmin.from("crm_meetings").update({ [job.claim]: null }).eq("id", m.id);
    }
  }
  return { due: data?.length ?? 0, sent };
}

export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const now = Date.now();
  const settings = await getSettings();
  const out: Record<string, { due: number; sent: number } | { error: string }> = {};
  for (const job of JOBS) {
    try {
      out[job.kind] = await runJob(job, now, settings);
    } catch (e) {
      out[job.kind] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return Response.json(out);
}
