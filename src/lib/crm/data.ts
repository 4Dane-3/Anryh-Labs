import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DEFAULT_SETTINGS, type CalendarMeeting, type CrmClient, type CrmColumn, type CrmMeeting, type CrmNote, type CrmSettings } from "@/lib/crm/types";

// Reads for the admin CRM. Every caller has already checked isAnryhAdmin(); these use the service role.

/** True when the error means the CRM migration hasn't been run yet. */
export const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /crm_\w+/.test(e.message ?? "") && /does not exist|schema cache/.test(e.message ?? ""));

export async function getSettings(): Promise<CrmSettings> {
  const { data } = await supabaseAdmin.from("crm_settings").select("meeting_url, meeting_details, from_name, reply_to, timezone, default_minutes").eq("id", true).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export async function getColumns(): Promise<CrmColumn[]> {
  const { data } = await supabaseAdmin.from("crm_columns").select("id, label, type, options, position").order("position").order("created_at");
  return (data ?? []) as CrmColumn[];
}

export async function getClientsPage(): Promise<{ ready: boolean; clients: CrmClient[]; columns: CrmColumn[]; settings: CrmSettings }> {
  const [clientsRes, columns, settings, meetingsRes] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("*").order("created_at", { ascending: false }).limit(5000),
    getColumns(),
    getSettings(),
    supabaseAdmin.from("crm_meetings").select("client_id, starts_at, status").gte("starts_at", new Date().toISOString()).neq("status", "cancelled").order("starts_at"),
  ]);
  if (missingTable(clientsRes.error)) return { ready: false, clients: [], columns: [], settings };
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  const next = new Map<string, { starts_at: string; status: CrmMeeting["status"] }>();
  for (const m of meetingsRes.data ?? []) if (!next.has(m.client_id)) next.set(m.client_id, { starts_at: m.starts_at, status: m.status });
  const clients = (clientsRes.data as CrmClient[]).map((c) => ({ ...c, next_meeting: next.get(c.id) ?? null }));
  return { ready: true, clients, columns, settings };
}

export async function getClientDetail(id: string) {
  const [client, notes, meetings, columns, settings] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin.from("crm_notes").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    supabaseAdmin.from("crm_meetings").select("*").eq("client_id", id).order("starts_at", { ascending: false }),
    getColumns(),
    getSettings(),
  ]);
  if (!client.data) return null;
  return { client: client.data as CrmClient, notes: (notes.data ?? []) as CrmNote[], meetings: (meetings.data ?? []) as CrmMeeting[], columns, settings };
}

export async function getMeetingsBetween(fromIso: string, toIso: string): Promise<{ ready: boolean; meetings: CalendarMeeting[] }> {
  const { data, error } = await supabaseAdmin
    .from("crm_meetings")
    .select("*, client:crm_clients(id, name, email)")
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at");
  if (missingTable(error)) return { ready: false, meetings: [] };
  if (error) throw new Error(error.message);
  return { ready: true, meetings: (data ?? []) as CalendarMeeting[] };
}

/** Name/email only, for the meeting form's client picker. */
export async function getClientOptions() {
  const { data } = await supabaseAdmin.from("crm_clients").select("id, name, email").order("name").limit(5000);
  return (data ?? []) as { id: string; name: string; email: string | null }[];
}

export async function getMeetingByToken(token: string) {
  if (!/^[a-f0-9]{32,128}$/.test(token)) return null;
  const { data } = await supabaseAdmin.from("crm_meetings").select("*, client:crm_clients(id, name, email)").eq("token", token).maybeSingle();
  return (data ?? null) as CalendarMeeting | null;
}
