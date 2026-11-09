import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DEFAULT_CTA_LABEL, DEFAULT_OFFER, DEFAULT_PROCESS, type CrmFollowUp, type CrmFollowUpEmail, type FollowUpCopy } from "@/lib/crm/followups";
import { dayIn, DEFAULT_SETTINGS, type CalendarMeeting, type CrmTask, type DueTask, type ClientRef, type CrmClient, type CrmColumn, type CrmMeeting, type CrmNote, type CrmSettings } from "@/lib/crm/types";

// Reads for the admin CRM. Every caller has already checked isAnryhAdmin(); these use the service role.

/** True when the error means the CRM migration hasn't been run yet. */
export const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /crm_\w+/.test(e.message ?? "") && /does not exist|schema cache/.test(e.message ?? ""));

export async function getSettings(): Promise<CrmSettings> {
  const { data } = await supabaseAdmin.from("crm_settings").select("meeting_url, meeting_details, from_name, reply_to, timezone, default_minutes").eq("id", true).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

/** What the follow-up emails say. Read on its own so the meeting settings still load before the migration runs. */
export async function getFollowUpCopy(): Promise<FollowUpCopy & { ready: boolean }> {
  const { data, error } = await supabaseAdmin.from("crm_settings").select("followup_offer, followup_process, followup_cta_url, followup_cta_label, postal_address").eq("id", true).maybeSingle();
  return {
    ready: !error,
    offer: data?.followup_offer?.trim() || DEFAULT_OFFER,
    process: data?.followup_process?.trim() || DEFAULT_PROCESS,
    ctaUrl: data?.followup_cta_url?.trim() || null,
    ctaLabel: data?.followup_cta_label?.trim() || DEFAULT_CTA_LABEL,
    postalAddress: data?.postal_address?.trim() || null,
  };
}

/** A client's follow-up sequence and the emails it has sent (null/[] before the migration or when none). */
export async function getClientFollowUp(clientId: string): Promise<{ followUp: CrmFollowUp | null; emails: CrmFollowUpEmail[] }> {
  const [f, e] = await Promise.all([
    supabaseAdmin.from("crm_followups").select("*").eq("client_id", clientId).maybeSingle(),
    supabaseAdmin.from("crm_followup_emails").select("*").eq("client_id", clientId).order("sent_at", { ascending: false }).limit(50),
  ]);
  return { followUp: (f.data ?? null) as CrmFollowUp | null, emails: (e.data ?? []) as CrmFollowUpEmail[] };
}

export async function getColumns(): Promise<CrmColumn[]> {
  const { data } = await supabaseAdmin.from("crm_columns").select("id, label, type, options, position").order("position").order("created_at");
  return (data ?? []) as CrmColumn[];
}

export async function getClientsPage(): Promise<{ ready: boolean; clients: CrmClient[]; columns: CrmColumn[]; settings: CrmSettings }> {
  const [clientsRes, columns, settings, meetingsRes, followRes] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("*").order("created_at", { ascending: false }).limit(5000),
    getColumns(),
    getSettings(),
    supabaseAdmin.from("crm_meetings").select("client_id, starts_at, status, outcome").gte("starts_at", new Date().toISOString()).neq("status", "cancelled").order("starts_at"),
    supabaseAdmin.from("crm_followups").select("client_id, status, cadence, next_send_at").in("status", ["active", "paused"]),
  ]);
  if (missingTable(clientsRes.error)) return { ready: false, clients: [], columns: [], settings };
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  const next = new Map<string, NonNullable<CrmClient["next_meeting"]>>();
  for (const m of meetingsRes.data ?? []) if (!next.has(m.client_id)) next.set(m.client_id, { starts_at: m.starts_at, status: m.status, outcome: m.outcome });
  const follow = new Map((followRes.data ?? []).map((f) => [f.client_id as string, f as NonNullable<CrmClient["followup"]>]));
  const clients = (clientsRes.data as CrmClient[]).map((c) => ({ ...c, next_meeting: next.get(c.id) ?? null, followup: follow.get(c.id) ?? null }));
  return { ready: true, clients, columns, settings };
}

export async function getClientDetail(id: string) {
  const [client, notes, meetings, columns, settings, tasks] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin.from("crm_notes").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabaseAdmin.from("crm_meetings").select("*").eq("client_id", id).order("starts_at", { ascending: false }),
    getColumns(),
    getSettings(),
    supabaseAdmin.from("crm_tasks").select("*").eq("client_id", id).order("done_at", { ascending: false, nullsFirst: true }).order("due_on").limit(200),
  ]);
  if (!client.data) return null;
  return { client: client.data as CrmClient, notes: (notes.data ?? []) as CrmNote[], meetings: (meetings.data ?? []) as CrmMeeting[], columns, settings, tasks: (tasks.data ?? []) as CrmTask[] };
}

export async function getMeetingsBetween(fromIso: string, toIso: string): Promise<{ ready: boolean; meetings: CalendarMeeting[] }> {
  const { data, error } = await supabaseAdmin
    .from("crm_meetings")
    .select("*, client:crm_clients(id, name, company, email)")
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at");
  if (missingTable(error)) return { ready: false, meetings: [] };
  if (error) throw new Error(error.message);
  return { ready: true, meetings: (data ?? []) as CalendarMeeting[] };
}

/** Name/email only, for the meeting form's client picker. */
export async function getClientOptions() {
  const { data } = await supabaseAdmin.from("crm_clients").select("id, name, company, email").order("name", { nullsFirst: false }).order("company").limit(5000);
  return (data ?? []) as ClientRef[];
}

export async function getMeetingByToken(token: string) {
  if (!/^[a-f0-9]{32,128}$/.test(token)) return null;
  const { data } = await supabaseAdmin.from("crm_meetings").select("*, client:crm_clients(id, name, company, email)").eq("token", token).maybeSingle();
  return (data ?? null) as CalendarMeeting | null;
}

/** Open tasks due today or earlier (staff timezone), oldest first, for the list at the top of the CRM. */
export async function getDueTasks(timezone: string): Promise<DueTask[]> {
  const { data } = await supabaseAdmin
    .from("crm_tasks")
    .select("*, client:crm_clients(id, name, company, email)")
    .is("done_at", null)
    .lte("due_on", dayIn(timezone, Date.now()))
    .order("due_on")
    .order("created_at")
    .limit(100);
  return (data ?? []) as DueTask[];
}

/**
 * Meetings to act on: today's that are still unconfirmed (call to confirm), and ones from the last two
 * weeks that have started but have no outcome yet. The caller works out which is which (meetingPhase).
 */
export async function getAttentionMeetings(timezone: string): Promise<CalendarMeeting[]> {
  const now = Date.now();
  const endOfToday = DateTime.now().setZone(timezone).endOf("day").toUTC().toISO()!;
  const { data } = await supabaseAdmin
    .from("crm_meetings")
    .select("*, client:crm_clients(id, name, company, email)")
    .in("status", ["invited", "confirmed"])
    .is("outcome", null)
    .gt("starts_at", new Date(now - 14 * 86_400_000).toISOString())
    .lte("starts_at", endOfToday)
    .order("starts_at")
    .limit(100);
  return (data ?? []) as CalendarMeeting[];
}
