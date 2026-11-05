import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSequenceEmail } from "@/lib/booking/email";
import { leadEmailSender } from "@/lib/booking/sites";
import { logActivity, type Subject } from "@/lib/dashboard/activity";
import { nextDueAt, sequenceWindowDays, sequencesFor, type Sequence, type SequenceKey } from "@/lib/email-sequences";

// The agent's automated emails (email-sequences.ts). A sequence starts only when the agent taps "Tried to call"
// or "Sent an email", never on its own, so someone they already talked to but didn't mark never gets "still
// thinking it over?". An email due "right away" goes with the tap; the rest go from the hourly run, each the
// agent's chosen number of days after the one before. Kept gentle so it reads like a person and stays out of
// spam: daytime only in the agent's timezone, a few per run, and it stops the moment the person books, is
// reached, sold or marked not interested (or moves to current plan). One sequence per person at a time.

/** Local hours scheduled emails go out in (9am to before 6pm), like a person writing during the workday. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 18;
/** Per agent per hourly run, so a backlog trickles out instead of landing all at once. */
const MAX_PER_RUN = 10;

const TABLE = { lead: "quote_requests", call: "bookings" } as const;
/** Answers that mean they haven't talked yet: anything else (reached, booked, sold, a no) stops the emails. */
const STILL_UNREACHED = { lead: ["not_reached"], call: ["no_show"] } as const;

export const validEmail = (e: string | null | undefined): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

type Row = {
  id: string;
  name: string;
  email: string | null;
  source?: string | null;
  booked_at?: string | null;
  outcome: string | null;
  client_status: string;
  email_sequence: SequenceKey | null;
  sequence_sent: number;
  sequence_started_at: string | null;
  sequence_last_at: string | null;
};

const viaOf = (subject: Subject, row: Pick<Row, "source">) => (subject.kind === "call" ? "booking" : row.source === "instant_form" ? "instant_form" : "page");

/** Whether this person can get the agent's automated emails at all right now (pure, for the tests). */
export function canEmail(subject: Subject, row: Pick<Row, "email" | "source" | "booked_at" | "outcome" | "client_status">) {
  if (row.source === "manual") return false; // personal clients didn't ask the agent's page or form to contact them
  if (!validEmail(row.email) || row.client_status !== "prospect") return false;
  if (subject.kind === "lead" && row.booked_at) return false;
  return !row.outcome || (STILL_UNREACHED[subject.kind] as readonly string[]).includes(row.outcome);
}

/** Whether the next email of a person's sequence is due now (pure, for the tests). */
export function sequenceDue(seq: Sequence, row: Pick<Row, "sequence_sent" | "sequence_started_at" | "sequence_last_at">, now: Date) {
  if (!seq.on || !row.sequence_started_at) return false;
  if (Date.parse(row.sequence_started_at) < now.getTime() - sequenceWindowDays(seq) * 86_400_000) return false;
  const due = nextDueAt(seq, row.sequence_sent, row.sequence_last_at ?? row.sequence_started_at);
  return !!due && due <= now;
}

/** Can a new sequence start for this person: none yet, or the last one has finished (pure). */
export function canStart(seq: Sequence, row: Pick<Row, "email_sequence" | "sequence_sent">, sequences: Record<SequenceKey, Sequence>) {
  if (!seq.on) return false;
  if (!row.email_sequence) return true;
  return row.sequence_sent >= sequences[row.email_sequence].emails.length;
}

const COLS = "id, name, email, outcome, client_status, email_sequence, sequence_sent, sequence_started_at, sequence_last_at";

/** Sends email `index` of a sequence and records it; false when it couldn't go (the claim is given back). */
async function sendOne(agent: Agent, subject: Subject, row: Row, key: SequenceKey, seq: Sequence, index: number) {
  const now = new Date().toISOString();
  // Claim it first, so two overlapping runs (or a tap and a run) can't both send the same email
  const { data: claimed } = await supabaseAdmin
    .from(TABLE[subject.kind])
    .update({ sequence_sent: index + 1, sequence_last_at: now, ...(subject.kind === "lead" ? { last_emailed_at: now } : {}) })
    .eq("id", row.id)
    .eq("email_sequence", key)
    .eq("sequence_sent", index)
    .select("id");
  if (!claimed?.length) return false;
  try {
    const res = await sendSequenceEmail({ agent, subjectKey: `${subject.kind}:${row.id}`, sequence: key, index, email: seq.emails[index], via: viaOf(subject, row), prospect: { name: row.name, email: row.email! } });
    if (res.skipped) throw new Error("sending is off");
    const label = key === "tried_call" ? "after the missed call" : "after your email";
    await logActivity(agent.id, subject, "email", `Automated email ${index + 1} of ${seq.emails.length} ${label}`);
    return true;
  } catch (e) {
    await supabaseAdmin.from(TABLE[subject.kind]).update({ sequence_sent: index, sequence_last_at: row.sequence_last_at }).eq("id", row.id);
    console.error("automated email failed", agent.slug, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Why a tap didn't start the emails, in the agent's words (or null when they started). */
export type StartResult = { started: boolean; sentNow: boolean; reason: string | null };

/**
 * The agent tapped "Tried to call" or "Sent an email": starts that sequence for this person when they can get
 * it, and sends its first email now if it's due right away.
 */
export async function startSequence(agent: Agent, subject: Subject, key: SequenceKey): Promise<StartResult> {
  const sequences = sequencesFor(agent);
  const seq = sequences[key];
  if (!agent.followup_emails) return { started: false, sentNow: false, reason: "Automated emails are off." };
  if (!seq.on) return { started: false, sentNow: false, reason: "This sequence is off." };
  if (!process.env.RESEND_API_KEY || !leadEmailSender(agent.slug)) return { started: false, sentNow: false, reason: "Emails to leads aren't set up for your account yet." };

  const cols = subject.kind === "lead" ? `${COLS}, source, booked_at` : COLS;
  const { data } = await supabaseAdmin.from(TABLE[subject.kind]).select(cols).eq("id", subject.id).eq("agent_id", agent.id).maybeSingle();
  const row = data as unknown as Row | null;
  if (!row) return { started: false, sentNow: false, reason: null };
  if (!canEmail(subject, row)) return { started: false, sentNow: false, reason: validEmail(row.email) ? null : "No email on file, so nothing is sent." };
  if (!canStart(seq, row, sequences)) return { started: false, sentNow: false, reason: "Their automated emails are already running." };

  const now = new Date().toISOString();
  const { data: started } = await supabaseAdmin
    .from(TABLE[subject.kind])
    .update({ email_sequence: key, sequence_sent: 0, sequence_started_at: now, sequence_last_at: now })
    .eq("id", row.id)
    .eq("sequence_sent", row.sequence_sent) // nobody started one a moment ago
    .select("id");
  if (!started?.length) return { started: false, sentNow: false, reason: null };
  const fresh = { ...row, email_sequence: key, sequence_sent: 0, sequence_started_at: now, sequence_last_at: now };
  let sentNow = false;
  if (seq.emails[0].afterDays === 0) {
    sentNow = await sendOne(agent, subject, fresh, key, seq, 0);
    // The card's "missed-call email" line
    if (sentNow && key === "tried_call") await supabaseAdmin.from(TABLE[subject.kind]).update({ tried_email_sent_at: now }).eq("id", row.id);
  }
  return { started: true, sentNow, reason: null };
}

/** Sends the scheduled sequence emails that are due for one agent. Returns how many went out. */
export async function sendDueSequenceEmails(agent: Agent, now: DateTime = DateTime.now()) {
  if (!agent.followup_emails || !process.env.RESEND_API_KEY || !leadEmailSender(agent.slug)) return 0;
  const local = now.setZone(agent.timezone);
  if (local.hour < SEND_FROM_HOUR || local.hour >= SEND_UNTIL_HOUR) return 0;
  const sequences = sequencesFor(agent);
  const longest = Math.max(...Object.values(sequences).map(sequenceWindowDays));
  const since = now.minus({ days: longest }).toUTC().toISO()!;

  let sent = 0;
  for (const kind of ["lead", "call"] as const) {
    let q = supabaseAdmin
      .from(TABLE[kind])
      .select(kind === "lead" ? `${COLS}, source, booked_at` : COLS)
      .eq("agent_id", agent.id)
      .eq("client_status", "prospect")
      .not("email_sequence", "is", null)
      .not("email", "is", null)
      .gte("sequence_started_at", since)
      .order("sequence_last_at", { ascending: true })
      .limit(200);
    if (kind === "lead") q = q.in("source", ["instant_form", "page"]).is("booked_at", null);
    const { data, error } = await q;
    if (error) continue;
    for (const row of (data ?? []) as unknown as Row[]) {
      if (sent >= MAX_PER_RUN) return sent;
      const subject = { kind, id: row.id };
      const seq = sequences[row.email_sequence!];
      if (!canEmail(subject, row) || !sequenceDue(seq, row, now.toJSDate())) continue;
      if (await sendOne(agent, subject, row, row.email_sequence!, seq, row.sequence_sent)) sent++;
    }
  }
  return sent;
}

/**
 * The hourly run for every agent with automated emails on (Slack or not). Called from the Migz cron, the hourly
 * job that's always scheduled. Returns slug -> emails sent, for the cron's log.
 */
export async function sendAllDueSequenceEmails(deadlineMs: number) {
  const { data } = await supabaseAdmin.from("agents").select("*").eq("active", true).eq("followup_emails", true);
  const out: Record<string, number> = {};
  for (const agent of (data ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    const sent = await sendDueSequenceEmails(agent).catch((e) => {
      console.error("automated emails failed", agent.slug, e instanceof Error ? e.message : e);
      return 0;
    });
    if (sent) out[agent.slug] = sent;
  }
  return out;
}
