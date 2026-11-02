import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import type { IntakeAnswers } from "@/lib/booking/questions";
import { sendTriedCallEmail } from "@/lib/booking/email";
import { usPhone } from "@/lib/booking/call";
import { logActivity, type ActivityKind, type AgentActivityKind, type Subject } from "@/lib/dashboard/activity";
import { recordOutcome } from "@/lib/dashboard/outcomes";
import { CLIENT_STATUSES, type ClientStatus, type OutcomeKind } from "@/lib/outcomes";

// The Clients tab: everyone who reached the agent, in one list. A booked call, an instant-form lead and a
// page quote request each become a client; a lead who went on to book is one client (the call leads, with
// the form's details on it). Each has a status (prospect → current plan, or not interested), notes, and a
// timeline. The agent can also add someone by hand (they called the agent directly, a referral): those are
// "personal" clients, kept apart from Migz's (never sent to Meta, emailed by us or counted in ad results).
// Before the client-cards migration the list is empty.

export type Client = {
  /** "call:<booking id>" or "lead:<quote request id>": the record the card answers for. */
  key: string;
  kind: OutcomeKind;
  id: string;
  /** Every record the card covers (the call, and the form lead it came from), for the timeline. */
  subjects: Subject[];
  name: string;
  phone: string;
  email: string | null;
  source: "instant_form" | "page" | "booking" | "manual";
  /** Who brought them in: Migz (an ad, the booking page, an instant form) or the agent themself. */
  origin: "migz" | "personal";
  status: ClientStatus;
  outcome: string | null;
  premiumCents: number | null;
  coverage: string | null;
  bestTime: string | null;
  /** When they first reached the agent (the form, the quote request, or the booking). */
  cameInAt: string;
  /** Which ad (or other source) brought them. */
  cameFrom: string;
  notes: string | null;
  call: { startsAt: string; endsAt: string; status: string; bookedAt: string; answers: IntakeAnswers | null; intakeCompleted: boolean } | null;
  triedEmailSentAt: string | null;
  /** The latest thing that happened, for sorting the list. */
  lastAt: string;
};

export type ClientActivity = { id: string; kind: ActivityKind; body: string | null; at: string; byAgent: boolean };

type LeadRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  coverage: string | null;
  best_time: string | null;
  source: string | null;
  booked_at: string | null;
  created_at: string;
  outcome: string | null;
  premium_cents: number | null;
  client_status: ClientStatus;
  agent_notes: string | null;
  meta_ad_id: string | null;
  attribution: Record<string, string> | null;
  tried_email_sent_at: string | null;
  personal_source: string | null;
};

type BookingRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  starts_at: string;
  ends_at: string;
  status: string;
  created_at: string;
  agent_notes: string | null;
  attribution: Record<string, string> | null;
  outcome: string | null;
  premium_cents: number | null;
  client_status: ClientStatus;
  tried_email_sent_at: string | null;
  intake_responses: { answers: IntakeAnswers; completed_at: string | null } | { answers: IntakeAnswers; completed_at: string | null }[] | null;
};

const LEAD_FIELDS =
  "id, name, phone, email, coverage, best_time, source, booked_at, created_at, outcome, premium_cents, client_status, agent_notes, meta_ad_id, attribution, tried_email_sent_at, personal_source";
const BOOKING_FIELDS =
  "id, name, email, phone, starts_at, ends_at, status, created_at, agent_notes, attribution, outcome, premium_cents, client_status, tried_email_sent_at, intake_responses(answers, completed_at)";

const phoneKey = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10) || null;
const emailKey = (e: string | null | undefined) => e?.trim().toLowerCase() || null;

const leadSource = (l: LeadRow): Client["source"] => (l.source === "instant_form" ? "instant_form" : l.source === "manual" ? "manual" : "page");

/** Where a lead came from, in words: who added them, or the ad by name when we know it. */
const leadCameFrom = (l: LeadRow, adNames: Map<string, string>) =>
  l.source === "manual"
    ? ["Added by you", l.personal_source].filter(Boolean).join(" · ")
    : cameFrom(l.meta_ad_id ? { ...l.attribution, utm_content: l.meta_ad_id } : l.attribution, adNames, l.source === "instant_form");

/** Where someone came from, in words: an ad by name when we know it. */
function cameFrom(attribution: Record<string, string> | null, adNames: Map<string, string>, formLead: boolean) {
  const a = attribution ?? {};
  const ad = a.utm_content ? adNames.get(a.utm_content) : undefined;
  if (formLead) return ad ? `Instant form · ${ad}` : "Instant form";
  const src = (a.utm_source ?? "").toLowerCase();
  if (a.fbclid || ["facebook", "fb", "instagram", "ig", "meta"].includes(src)) return ad ? `Meta ad · ${ad}` : ["Meta ad", a.utm_campaign].filter(Boolean).join(" · ");
  if (src === "email") return "Follow-up email";
  if (src) return [a.utm_source, a.utm_campaign].filter(Boolean).join(" · ");
  return "Direct visit to your page";
}

/** Everyone who reached the agent, newest activity first. */
export async function getClients(agentId: string): Promise<Client[]> {
  const [leadsRes, bookingsRes, activityRes] = await Promise.all([
    supabaseAdmin.from("quote_requests").select(LEAD_FIELDS).eq("agent_id", agentId).order("created_at", { ascending: false }).limit(500),
    supabaseAdmin.from("bookings").select(BOOKING_FIELDS).eq("agent_id", agentId).order("created_at", { ascending: false }).limit(500),
    supabaseAdmin.from("client_activities").select("subject_kind, subject_id, at").eq("agent_id", agentId).order("at", { ascending: false }).limit(3000),
  ]);
  if (leadsRes.error || bookingsRes.error) return [];
  const leads = (leadsRes.data ?? []) as unknown as LeadRow[];
  const bookings = (bookingsRes.data ?? []) as unknown as BookingRow[];

  const adIds = [...new Set([...leads.map((l) => l.meta_ad_id ?? l.attribution?.utm_content), ...bookings.map((b) => b.attribution?.utm_content)].filter((x): x is string => !!x))];
  const adNames = new Map<string, string>();
  if (adIds.length) {
    const { data } = await supabaseAdmin.from("ads").select("meta_ad_id, name").in("meta_ad_id", adIds);
    for (const a of data ?? []) adNames.set(a.meta_ad_id, a.name);
  }
  const lastAt = new Map<string, string>();
  for (const a of activityRes.data ?? []) {
    const k = `${a.subject_kind}:${a.subject_id}`;
    if (!lastAt.has(k)) lastAt.set(k, a.at);
  }

  // A lead who booked is the same person as the booking: matched on phone or email
  const leadByContact = new Map<string, LeadRow>();
  for (const l of [...leads].reverse()) {
    for (const k of [phoneKey(l.phone), emailKey(l.email)]) if (k) leadByContact.set(k, l);
  }
  const merged = new Set<string>();
  const latest = (...xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1)!;

  const clients: Client[] = [];
  for (const b of bookings) {
    const lead = [phoneKey(b.phone), emailKey(b.email)].map((k) => (k ? leadByContact.get(k) : undefined)).find((l) => l && !merged.has(l.id));
    if (lead) merged.add(lead.id);
    const intake = Array.isArray(b.intake_responses) ? b.intake_responses[0] : b.intake_responses;
    const subjects: Subject[] = [{ kind: "call", id: b.id }, ...(lead ? [{ kind: "lead" as const, id: lead.id }] : [])];
    clients.push({
      key: `call:${b.id}`,
      kind: "call",
      id: b.id,
      subjects,
      name: b.name,
      phone: b.phone,
      email: b.email,
      source: lead ? leadSource(lead) : "booking",
      origin: lead?.source === "manual" ? "personal" : "migz",
      status: b.client_status ?? "prospect",
      outcome: b.outcome,
      premiumCents: b.premium_cents,
      coverage: lead?.coverage ?? null,
      bestTime: lead?.best_time ?? null,
      cameInAt: lead?.created_at ?? b.created_at,
      cameFrom: lead ? leadCameFrom(lead, adNames) : cameFrom(b.attribution, adNames, false),
      notes: b.agent_notes ?? lead?.agent_notes ?? null,
      call: {
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        status: b.status,
        bookedAt: b.created_at,
        answers: intake?.answers && Object.keys(intake.answers).length ? intake.answers : null,
        intakeCompleted: !!intake?.completed_at,
      },
      triedEmailSentAt: b.tried_email_sent_at ?? lead?.tried_email_sent_at ?? null,
      lastAt: latest(b.created_at, lead?.created_at, ...subjects.map((s) => lastAt.get(`${s.kind}:${s.id}`))),
    });
  }
  for (const l of leads) {
    if (merged.has(l.id)) continue;
    clients.push({
      key: `lead:${l.id}`,
      kind: "lead",
      id: l.id,
      subjects: [{ kind: "lead", id: l.id }],
      name: l.name,
      phone: l.phone,
      email: l.email,
      source: leadSource(l),
      origin: l.source === "manual" ? "personal" : "migz",
      status: l.client_status ?? "prospect",
      outcome: l.outcome,
      premiumCents: l.premium_cents,
      coverage: l.coverage,
      bestTime: l.best_time,
      cameInAt: l.created_at,
      cameFrom: leadCameFrom(l, adNames),
      notes: l.agent_notes,
      call: null,
      triedEmailSentAt: l.tried_email_sent_at,
      lastAt: latest(l.created_at, lastAt.get(`lead:${l.id}`)),
    });
  }
  return clients.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** The logged timeline of a card's records, newest first. Only the agent's own records. */
export async function getClientActivity(agentId: string, subjects: Subject[]): Promise<ClientActivity[]> {
  if (!subjects.length) return [];
  const ors = subjects.map((s) => `and(subject_kind.eq.${s.kind},subject_id.eq.${s.id})`).join(",");
  const { data, error } = await supabaseAdmin
    .from("client_activities")
    .select("id, kind, body, at, by_agent")
    .eq("agent_id", agentId)
    .or(ors)
    .order("at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((a) => ({ id: a.id, kind: a.kind as ActivityKind, body: a.body, at: a.at, byAgent: a.by_agent }));
}

const TABLE = { call: "bookings", lead: "quote_requests" } as const;

export type NewClient = { name: string; phone: string; email: string; foundVia: string; coverage: string; status: ClientStatus; notes: string };

/**
 * Adds someone the agent found themself (they called directly, a referral) to their Clients, as a personal
 * client. Refuses a number or email that's already on their list, and says who has it.
 */
export async function addPersonalClient(agentId: string, input: NewClient): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 120);
  const phone = usPhone(input.phone);
  const email = input.email.trim().toLowerCase().slice(0, 200) || null;
  if (!name) return { ok: false, error: "Add their name." };
  if (!phone) return { ok: false, error: "Add a US phone number (10 digits)." };
  if (email && !validEmail(email)) return { ok: false, error: "That email doesn't look right." };

  const digits = phone.slice(-10);
  // Same number in any format, or the same email (quoted, so a comma in it can't break the filter)
  const contact = [`phone.like.*${digits}`, ...(email ? [`email.ilike."${email.replace(/["\\]/g, "")}"`] : [])].join(",");
  const [leads, bookings] = await Promise.all([
    supabaseAdmin.from("quote_requests").select("name").eq("agent_id", agentId).or(contact).limit(1),
    supabaseAdmin.from("bookings").select("name").eq("agent_id", agentId).or(contact).limit(1),
  ]);
  const existing = leads.data?.[0] ?? bookings.data?.[0];
  if (existing) return { ok: false, error: `${existing.name} already has that number or email in your clients.` };

  const status = input.status === "current" ? "current" : "prospect";
  const { data, error } = await supabaseAdmin
    .from("quote_requests")
    .insert({
      agent_id: agentId,
      source: "manual",
      name,
      phone,
      email,
      coverage: input.coverage.trim().slice(0, 80) || null,
      personal_source: input.foundVia.trim().slice(0, 120) || null,
      client_status: status,
      agent_notes: input.notes.trim().slice(0, 5000) || null,
      // Not a consent record: the agent added them; nothing is sent to them or to Meta
      consent_text: "Added by the agent (a personal client, not from Migz).",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add them. If this keeps happening, the latest migration may not have run yet." };
  if (status === "current") await logActivity(agentId, { kind: "lead", id: data.id }, "status", "Current plan");
  return { ok: true, key: `lead:${data.id}` };
}
const validEmail = (e: string | null | undefined): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/**
 * The agent tried to call and didn't get through: logged on the card, the answer set to couldn't reach (or
 * no show, once the call's time has passed) unless they already answered, and, when the agent has it on,
 * the "sorry I missed you" email with their booking link. That email goes once per person, never to someone
 * marked not interested, and never to a form lead who has already booked.
 */
export async function triedToCall(agent: Agent, subject: Subject) {
  const cols = subject.kind === "call" ? "id, name, email, outcome, client_status, tried_email_sent_at, starts_at" : "id, name, email, outcome, client_status, tried_email_sent_at, source, booked_at";
  const { data, error } = await supabaseAdmin.from(TABLE[subject.kind]).select(cols).eq("id", subject.id).eq("agent_id", agent.id).maybeSingle();
  const row = data as unknown as {
    name: string;
    email: string | null;
    outcome: string | null;
    client_status: ClientStatus;
    tried_email_sent_at: string | null;
    starts_at?: string;
    source?: string | null;
    booked_at?: string | null;
  } | null;
  if (error || !row) return { ok: false as const };
  await logActivity(agent.id, subject, "tried_call", null, { byAgent: true });
  if (!row.outcome) {
    if (subject.kind === "lead") await recordOutcome(agent.id, "lead", subject.id, "not_reached");
    else if (row.starts_at && row.starts_at < new Date().toISOString()) await recordOutcome(agent.id, "call", subject.id, "no_show");
  }

  let emailed = false;
  // Personal clients never get our emails: they didn't ask the agent's page or form to contact them
  if (agent.followup_emails && row.source !== "manual" && validEmail(row.email) && row.client_status !== "not_interested" && !row.tried_email_sent_at && !row.booked_at) {
    try {
      const via = subject.kind === "call" ? "booking" : row.source === "instant_form" ? "instant_form" : "page";
      const res = await sendTriedCallEmail({ agent, subjectId: subject.id, via, prospect: { name: row.name, email: row.email } });
      if (!res.skipped) {
        emailed = true;
        const now = new Date().toISOString();
        // A lead's next 48-hour follow-up counts from this email
        await supabaseAdmin.from(TABLE[subject.kind]).update({ tried_email_sent_at: now, ...(subject.kind === "lead" ? { last_emailed_at: now } : {}) }).eq("id", subject.id);
        await logActivity(agent.id, subject, "email", "Sorry I missed you (with your booking link)");
      }
    } catch (e) {
      console.error("tried-call email failed", e instanceof Error ? e.message : e);
    }
  }
  return { ok: true as const, emailed };
}

/**
 * One tap from the dashboard or Slack: an outcome (saved, status moved, Meta told) or "tried_call".
 * Returns false when the lead isn't the agent's or the answer isn't valid.
 */
export async function clientTap(agent: Agent, subject: Subject, action: string, premiumCents?: number | null) {
  if (action === "tried_call") return (await triedToCall(agent, subject)).ok;
  return recordOutcome(agent.id, subject.kind, subject.id, action, premiumCents);
}

/**
 * The agent sets someone's status by hand. "Not interested" is also their answer (so Meta hears it and the
 * outcome matches); taking it back makes them a prospect again. "Current" leaves the answer as it is: they
 * may have had a plan with the agent already.
 */
export async function setClientStatus(agentId: string, subject: Subject, status: ClientStatus) {
  if (status === "not_interested") return recordOutcome(agentId, subject.kind, subject.id, "not_interested");
  const { data, error } = await supabaseAdmin.from(TABLE[subject.kind]).select("client_status, outcome").eq("id", subject.id).eq("agent_id", agentId).maybeSingle();
  if (error || !data) return false;
  if (data.client_status === status) return true;
  const { error: saveError } = await supabaseAdmin
    .from(TABLE[subject.kind])
    // Out of "not interested", the answer goes too, so it doesn't count against the ad
    .update({ client_status: status, ...(data.outcome === "not_interested" ? { outcome: null, outcome_at: null } : {}) })
    .eq("id", subject.id);
  if (saveError) return false;
  await logActivity(agentId, subject, "status", CLIENT_STATUSES.find((s) => s.key === status)!.label);
  return true;
}

export async function saveClientNotes(agentId: string, subject: Subject, notes: string) {
  const { error } = await supabaseAdmin
    .from(TABLE[subject.kind])
    .update({ agent_notes: notes.trim().slice(0, 5000) || null })
    .eq("id", subject.id)
    .eq("agent_id", agentId);
  return !error;
}

/** An entry the agent adds by hand ("tried to call", "left a voicemail", a note), at the time they say. */
export async function addClientActivity(agent: Agent, subject: Subject, kind: AgentActivityKind, body: string, at: string) {
  const { data } = await supabaseAdmin.from(TABLE[subject.kind]).select("id").eq("id", subject.id).eq("agent_id", agent.id).maybeSingle();
  if (!data) return false;
  // Logging a missed call now is the same as tapping "Tried to call" (answer and email included)
  if (kind === "tried_call" && !body && Math.abs(Date.parse(at) - Date.now()) < 5 * 60_000) return (await triedToCall(agent, subject)).ok;
  await logActivity(agent.id, subject, kind, body, { byAgent: true, at });
  return true;
}

/** Edits one of the agent's own entries; the system's entries can't be changed. */
export async function updateClientActivity(agentId: string, id: string, patch: { kind: AgentActivityKind; body: string; at: string }) {
  const { data, error } = await supabaseAdmin
    .from("client_activities")
    .update({ kind: patch.kind, body: patch.body.slice(0, 2000) || null, at: patch.at })
    .eq("id", id)
    .eq("agent_id", agentId)
    .eq("by_agent", true)
    .select("id");
  return !error && !!data?.length;
}

export async function deleteClientActivity(agentId: string, id: string) {
  const { data, error } = await supabaseAdmin.from("client_activities").delete().eq("id", id).eq("agent_id", agentId).eq("by_agent", true).select("id");
  return !error && !!data?.length;
}
