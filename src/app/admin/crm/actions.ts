"use server";

import { revalidatePath } from "next/cache";
import { DateTime, IANAZone } from "luxon";
import { isAnryhAdmin } from "@/lib/auth";
import { createSupabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { phoneDigits } from "@/lib/crm/csv";
import { getSettings } from "@/lib/crm/data";
import { describeOutcome, sendMeetingEmail } from "@/lib/crm/email";
import { deleteZoomMeeting, upsertZoomMeeting, zoomReady } from "@/lib/crm/zoom";
import {
  CLIENT_STATUSES,
  clientLabel,
  COLUMN_TYPES,
  OPTION_COLORS,
  type ClientStatus,
  type ColumnType,
  type CrmColumn,
  type CrmMeeting,
  type CustomValue,
  type ImportRow,
  type OptionColor,
} from "@/lib/crm/types";

type Result<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

async function staff() {
  if (!(await isAnryhAdmin())) return null;
  const { data } = await (await createSupabaseServer()).auth.getUser();
  return data.user?.email ?? "staff";
}

const refresh = (clientId?: string) => {
  revalidatePath("/admin/clients");
  revalidatePath("/admin/calendar");
  if (clientId) revalidatePath(`/admin/clients/${clientId}`);
};

const clean = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

function dupeError(e: { code?: string; message?: string }) {
  if (e.code !== "23505") return null;
  return /phone/.test(e.message ?? "") ? "A client with that phone number already exists." : "A client with that email already exists.";
}

// ---------- Clients ----------

export async function saveClient(input: { id?: string; name?: string; email?: string; phone?: string; company?: string; status?: string }): Promise<Result<{ id: string }>> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const name = clean(input.name);
  const company = clean(input.company);
  if (!name && !company) return { ok: false, error: "Add a company or a contact name." };
  const email = clean(input.email)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email doesn't look right." };
  const phone = clean(input.phone, 40);
  if (phone && phoneDigits(phone).length < 7) return { ok: false, error: "That phone number looks too short." };
  const status = (CLIENT_STATUSES as readonly string[]).includes(input.status ?? "") ? (input.status as ClientStatus) : "lead";
  const row = { name, email, phone, company, status, updated_at: new Date().toISOString() };
  const q = input.id ? supabaseAdmin.from("crm_clients").update(row).eq("id", input.id) : supabaseAdmin.from("crm_clients").insert(row);
  const { data, error } = await q.select("id").single();
  if (error) return { ok: false, error: dupeError(error) ?? "Couldn't save that client." };
  refresh(data.id);
  return { ok: true, id: data.id };
}

export async function deleteClient(id: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const { data: zooms } = await supabaseAdmin.from("crm_meetings").select("zoom_meeting_id").eq("client_id", id).not("zoom_meeting_id", "is", null).gte("starts_at", new Date().toISOString());
  if (zoomReady()) for (const z of zooms ?? []) await deleteZoomMeeting(z.zoom_meeting_id!).catch(() => {});
  const { error } = await supabaseAdmin.from("crm_clients").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete that client." };
  refresh();
  return { ok: true };
}

function coerce(col: Pick<CrmColumn, "type" | "options">, value: unknown): CustomValue | undefined {
  if (value === null || value === "" || value === undefined) return null;
  switch (col.type) {
    case "checkbox":
      return value === true || value === "true" || /^(y|yes|x|1|true|✓)$/i.test(String(value).trim());
    case "number": {
      const n = Number(String(value).replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    }
    case "date": {
      const s = String(value).trim();
      const d = [DateTime.fromISO(s), DateTime.fromFormat(s, "M/d/yyyy"), DateTime.fromFormat(s, "M/d/yy"), DateTime.fromRFC2822(s)].find((x) => x.isValid);
      return d ? d.toISODate() : undefined;
    }
    case "select": {
      const s = String(value).trim();
      return col.options.find((o) => o.value.toLowerCase() === s.toLowerCase())?.value ?? undefined;
    }
    default:
      return String(value).slice(0, 2000);
  }
}

/** One cell from the table: the status or a custom column's value. */
export async function setClientField(clientId: string, field: string, value: unknown): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  if (field === "status") {
    if (!(CLIENT_STATUSES as readonly string[]).includes(String(value))) return { ok: false, error: "Unknown status." };
    const { error } = await supabaseAdmin.from("crm_clients").update({ status: value, updated_at: new Date().toISOString() }).eq("id", clientId);
    if (error) return { ok: false, error: "Couldn't save that." };
    refresh(clientId);
    return { ok: true };
  }
  const [{ data: col }, { data: client }] = await Promise.all([
    supabaseAdmin.from("crm_columns").select("type, options").eq("id", field).maybeSingle(),
    supabaseAdmin.from("crm_clients").select("custom").eq("id", clientId).maybeSingle(),
  ]);
  if (!col || !client) return { ok: false, error: "That column or client is gone." };
  const v = coerce(col as CrmColumn, value);
  if (v === undefined) return { ok: false, error: col.type === "select" ? "Pick one of the options." : `That isn't a valid ${col.type}.` };
  const custom = { ...(client.custom as Record<string, CustomValue>) };
  if (v === null) delete custom[field];
  else custom[field] = v;
  const { error } = await supabaseAdmin.from("crm_clients").update({ custom, updated_at: new Date().toISOString() }).eq("id", clientId);
  if (error) return { ok: false, error: "Couldn't save that." };
  refresh(clientId);
  return { ok: true };
}

/**
 * CSV import (the browser parses the file and maps its columns). Skips rows without a name, with a bad
 * email, and anyone already in the list by email or phone, including repeats inside the file itself.
 */
export async function importClients(rows: ImportRow[]): Promise<Result<{ imported: number; duplicates: number; invalid: number; cleaned: number }>> {
  const who = await staff();
  if (!who) return { ok: false, error: "Staff only." };
  if (!Array.isArray(rows) || rows.length > 2000) return { ok: false, error: "Send at most 2,000 rows at a time." };

  const [{ data: existing }, { data: cols }] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("name, company, email, phone").limit(50000),
    supabaseAdmin.from("crm_columns").select("id, type, options"),
  ]);
  const emails = new Set((existing ?? []).map((c) => c.email?.toLowerCase()).filter(Boolean));
  const phones = new Set((existing ?? []).map((c) => c.phone && phoneDigits(c.phone)).filter(Boolean));
  const colById = new Map((cols ?? []).map((c) => [c.id, c as CrmColumn]));
  // Clients with no email or phone are matched on name + company, so importing the same list twice doesn't double it
  const nameKey = (name: string | null, company: string | null) => `${name?.toLowerCase() ?? ""}|${company?.toLowerCase() ?? ""}`;
  const names = new Set((existing ?? []).filter((c) => !c.email && !c.phone).map((c) => nameKey(c.name, c.company)));

  let duplicates = 0;
  let invalid = 0;
  let cleaned = 0;
  const insert: { row: Record<string, unknown>; note: string | null }[] = [];
  for (const r of rows) {
    const name = clean(r.name);
    const company = clean(r.company);
    if (!name && !company) {
      invalid++;
      continue;
    }
    // An email or phone that isn't one ("Not verified", "n/a") is left blank, and kept in a note
    const kept: string[] = [];
    const emailRaw = clean(r.email);
    const email = emailRaw && EMAIL.test(emailRaw.toLowerCase()) ? emailRaw.toLowerCase() : null;
    if (emailRaw && !email) kept.push(`Email in the CSV: ${emailRaw}`);
    const phoneRaw = clean(r.phone, 40);
    const digits = phoneRaw ? phoneDigits(phoneRaw) : "";
    const phone = digits.length >= 7 && digits.length <= 15 ? phoneRaw : null;
    if (phoneRaw && !phone) kept.push(`Phone in the CSV: ${phoneRaw}`);
    if (kept.length) cleaned++;

    const key = nameKey(name, company);
    if ((email && emails.has(email)) || (phone && phones.has(digits)) || (!email && !phone && names.has(key))) {
      duplicates++;
      continue;
    }
    if (email) emails.add(email);
    if (phone) phones.add(digits);
    if (!email && !phone) names.add(key);
    const custom: Record<string, CustomValue> = {};
    for (const [id, raw] of Object.entries(r.custom ?? {})) {
      const col = colById.get(id);
      const v = col ? coerce(col, raw) : undefined;
      if (v !== undefined && v !== null) custom[id] = v;
    }
    const status = (CLIENT_STATUSES as readonly string[]).find((s) => s === r.status?.trim().toLowerCase()) ?? "lead";
    const note = [clean(r.note, 10000), ...kept].filter(Boolean).join("\n\n") || null;
    insert.push({ row: { name, email, phone, company, status, custom, source: "csv" }, note });
  }

  let imported = 0;
  for (let i = 0; i < insert.length; i += 500) {
    const batch = insert.slice(i, i + 500);
    const { data, error } = await supabaseAdmin.from("crm_clients").insert(batch.map((b) => b.row)).select("id");
    let ids: (string | null)[] = (data ?? []).map((d) => d.id);
    if (error) {
      // Someone was added meanwhile: fall back to one at a time so the rest still go in
      ids = [];
      for (const b of batch) {
        const one = await supabaseAdmin.from("crm_clients").insert(b.row).select("id").single();
        // Only a clash with the unique email/phone index is a duplicate; anything else stops the import
        if (one.error && one.error.code !== "23505") {
          refresh();
          return { ok: false, error: `Stopped after ${imported + ids.filter(Boolean).length} rows: ${one.error.message}` };
        }
        if (one.error) duplicates++;
        ids.push(one.data?.id ?? null);
      }
    }
    imported += ids.filter(Boolean).length;
    const notes = batch.flatMap((b, j) => (b.note && ids[j] ? [{ client_id: ids[j], body: b.note, author: `${who} (CSV import)` }] : []));
    if (notes.length) await supabaseAdmin.from("crm_notes").insert(notes);
  }
  refresh();
  return { ok: true, imported, duplicates, invalid, cleaned };
}

// ---------- Custom columns ----------

function cleanOptions(type: ColumnType, options: unknown) {
  if (type !== "select" || !Array.isArray(options)) return [];
  const seen = new Set<string>();
  return options
    .map((o) => ({ value: clean((o as { value?: unknown })?.value, 60), color: (OPTION_COLORS as readonly string[]).includes((o as { color?: string })?.color ?? "") ? ((o as { color: OptionColor }).color) : "neutral" }))
    .filter((o): o is { value: string; color: OptionColor } => !!o.value && !seen.has(o.value.toLowerCase()) && !!seen.add(o.value.toLowerCase()))
    .slice(0, 30);
}

export async function saveColumn(input: { id?: string; label: string; type: string; options?: { value: string; color: string }[] }): Promise<Result<{ column: CrmColumn }>> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const label = clean(input.label, 60);
  if (!label) return { ok: false, error: "Name the column." };
  if (!(COLUMN_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: "Pick a column type." };
  const type = input.type as ColumnType;
  const options = cleanOptions(type, input.options);
  if (type === "select" && !options.length) return { ok: false, error: "Add at least one option." };
  let res;
  if (input.id) {
    res = await supabaseAdmin.from("crm_columns").update({ label, options }).eq("id", input.id).select("id, label, type, options, position").single();
  } else {
    const { data: last } = await supabaseAdmin.from("crm_columns").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    res = await supabaseAdmin.from("crm_columns").insert({ label, type, options, position: (last?.position ?? -1) + 1 }).select("id, label, type, options, position").single();
  }
  if (res.error) return { ok: false, error: "Couldn't save that column." };
  refresh();
  return { ok: true, column: res.data as CrmColumn };
}

/** Removes the column. Its values stay on the client rows, unseen, until a client is next saved. */
export async function deleteColumn(id: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const { error } = await supabaseAdmin.from("crm_columns").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete that column." };
  refresh();
  return { ok: true };
}

export async function moveColumn(id: string, dir: -1 | 1): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const { data } = await supabaseAdmin.from("crm_columns").select("id, position").order("position").order("created_at");
  const list = data ?? [];
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  await Promise.all(list.map((c, k) => supabaseAdmin.from("crm_columns").update({ position: k }).eq("id", c.id)));
  refresh();
  return { ok: true };
}

// ---------- Notes ----------

export async function addNote(clientId: string, body: string): Promise<Result> {
  const who = await staff();
  if (!who) return { ok: false, error: "Staff only." };
  const text = clean(body, 10000);
  if (!text) return { ok: false, error: "Write something first." };
  const { error } = await supabaseAdmin.from("crm_notes").insert({ client_id: clientId, body: text, author: who });
  if (error) return { ok: false, error: "Couldn't save that note." };
  refresh(clientId);
  return { ok: true };
}

export async function deleteNote(id: number, clientId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const { error } = await supabaseAdmin.from("crm_notes").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete that note." };
  refresh(clientId);
  return { ok: true };
}

// ---------- Meetings ----------

export type MeetingInput = {
  id?: string;
  clientId: string;
  title: string;
  date: string; // yyyy-MM-dd in `timezone`
  time: string; // HH:mm in `timezone`
  minutes: number;
  timezone: string;
  meetingUrl?: string;
  meetingDetails?: string;
  description?: string;
  zoom?: boolean; // create a Zoom meeting for it (needs the Zoom env vars)
  send: boolean; // email the invite (or the update) now
};

export async function saveMeeting(input: MeetingInput): Promise<Result<{ id: string }>> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  if (!isUuid(input.clientId)) return { ok: false, error: "Pick a client." };
  const title = clean(input.title);
  if (!title) return { ok: false, error: "Give the meeting a title." };
  if (!IANAZone.isValidZone(input.timezone)) return { ok: false, error: "Pick a timezone." };
  const minutes = Math.round(Number(input.minutes));
  if (!(minutes >= 5 && minutes <= 480)) return { ok: false, error: "Length must be 5 minutes to 8 hours." };
  const start = DateTime.fromISO(`${input.date}T${input.time}`, { zone: input.timezone });
  if (!start.isValid) return { ok: false, error: "Pick a date and time." };
  let meetingUrl = clean(input.meetingUrl, 1000);
  if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) meetingUrl = `https://${meetingUrl}`;
  if (meetingUrl) {
    try {
      new URL(meetingUrl);
    } catch {
      return { ok: false, error: "That meeting link doesn't look right." };
    }
  }

  const [{ data: client }, previous] = await Promise.all([
    supabaseAdmin.from("crm_clients").select("id, name, company, email, status").eq("id", input.clientId).maybeSingle(),
    input.id ? supabaseAdmin.from("crm_meetings").select("*").eq("id", input.id).maybeSingle().then((r) => r.data as CrmMeeting | null) : Promise.resolve(null),
  ]);
  if (!client) return { ok: false, error: "That client is gone." };
  if (input.send && !client.email) return { ok: false, error: `${clientLabel(client)} has no email. Add one, or save without sending.` };
  if (input.id && !previous) return { ok: false, error: "That meeting is gone." };

  const startsAt = start.toUTC().toISO()!;
  const endsAt = start.plus({ minutes }).toUTC().toISO()!;
  let meetingDetails = clean(input.meetingDetails, 2000);
  let zoomId = previous?.zoom_meeting_id ?? null;
  if (input.zoom) {
    if (!zoomReady()) return { ok: false, error: "Zoom isn't connected: add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET." };
    try {
      const z = await upsertZoomMeeting({ id: zoomId, topic: title, startsAt, minutes, timezone: input.timezone });
      zoomId = z.id;
      meetingUrl = z.joinUrl;
      meetingDetails = z.details;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Zoom didn't create the meeting." };
    }
  }

  const timeChanged = !previous || previous.starts_at !== startsAt || previous.ends_at !== endsAt;
  const row = {
    client_id: client.id,
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: input.timezone,
    meeting_url: meetingUrl,
    meeting_details: meetingDetails,
    description: clean(input.description, 4000),
    zoom_meeting_id: zoomId,
    // A new time needs a fresh confirmation, and a fresh reminder
    ...(previous && timeChanged && previous.status === "confirmed" ? { status: "invited", confirmed_at: null } : {}),
    ...(previous && timeChanged ? { reminder_sent_at: null } : {}),
    ...(previous && input.send ? { sequence: previous.sequence + 1 } : {}),
  };
  const res = previous
    ? await supabaseAdmin.from("crm_meetings").update(row).eq("id", previous.id).select("*").single()
    : await supabaseAdmin.from("crm_meetings").insert(row).select("*").single();
  if (res.error) return { ok: false, error: "Couldn't save that meeting." };
  let meeting = res.data as CrmMeeting;

  if (client.status === "lead" || client.status === "contacted") await supabaseAdmin.from("crm_clients").update({ status: "meeting" }).eq("id", client.id);

  let message = previous ? "Meeting saved." : "Meeting saved as a draft.";
  if (input.send) {
    try {
      const settings = await getSettings();
      const kind = previous && previous.invited_at && previous.status !== "cancelled" ? "update" : "invite";
      if (meeting.status === "draft" || meeting.status === "cancelled") {
        const upd = await supabaseAdmin.from("crm_meetings").update({ status: "invited", cancelled_at: null, cancelled_by: null, confirmed_at: null, reminder_sent_at: null }).eq("id", meeting.id).select("*").single();
        if (upd.data) meeting = upd.data as CrmMeeting;
      }
      const outcome = await sendMeetingEmail({ kind, meeting, client: { name: client.name, email: client.email! }, settings });
      await supabaseAdmin.from("crm_meetings").update({ invited_at: new Date().toISOString() }).eq("id", meeting.id);
      message = describeOutcome(outcome, kind === "update" ? "Update" : "Invite");
    } catch (e) {
      console.error("crm invite failed", e);
      refresh(client.id);
      return { ok: false, error: `Saved, but the email didn't send: ${e instanceof Error ? e.message : "unknown error"}` };
    }
  }
  refresh(client.id);
  return { ok: true, id: meeting.id, message };
}

export async function cancelMeeting(id: string, notify: boolean): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const { data } = await supabaseAdmin.from("crm_meetings").select("*, client:crm_clients(name, company, email)").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "That meeting is gone." };
  const m = data as CrmMeeting & { client: { name: string; email: string | null } };
  const { data: updated, error } = await supabaseAdmin
    .from("crm_meetings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: "staff", sequence: m.sequence + 1 })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { ok: false, error: "Couldn't cancel that meeting." };
  if (m.zoom_meeting_id && zoomReady()) await deleteZoomMeeting(m.zoom_meeting_id).catch(() => {});
  let message = "Meeting cancelled.";
  if (notify && m.invited_at && m.client.email) {
    try {
      const outcome = await sendMeetingEmail({ kind: "cancel", meeting: updated as CrmMeeting, client: { name: m.client.name, email: m.client.email }, settings: await getSettings() });
      message = `Meeting cancelled. ${describeOutcome(outcome, "Cancellation")}`;
    } catch (e) {
      message = `Meeting cancelled, but the email didn't send: ${e instanceof Error ? e.message : "unknown error"}`;
    }
  }
  refresh(m.client_id);
  return { ok: true, message };
}

export async function deleteMeeting(id: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const { data } = await supabaseAdmin.from("crm_meetings").delete().eq("id", id).select("client_id, zoom_meeting_id").maybeSingle();
  if (data?.zoom_meeting_id && zoomReady()) await deleteZoomMeeting(data.zoom_meeting_id).catch(() => {});
  refresh(data?.client_id);
  return { ok: true };
}

// ---------- Settings ----------

export async function saveSettings(input: { meetingUrl?: string; meetingDetails?: string; fromName: string; replyTo?: string; timezone: string; defaultMinutes: number }): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Staff only." };
  const fromName = clean(input.fromName, 80);
  if (!fromName) return { ok: false, error: "Add the name invites go out under." };
  const replyTo = clean(input.replyTo)?.toLowerCase() ?? null;
  if (replyTo && !EMAIL.test(replyTo)) return { ok: false, error: "That reply-to email doesn't look right." };
  if (!IANAZone.isValidZone(input.timezone)) return { ok: false, error: "Pick a timezone." };
  let meetingUrl = clean(input.meetingUrl, 1000);
  if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) meetingUrl = `https://${meetingUrl}`;
  const minutes = Math.round(Number(input.defaultMinutes));
  if (!(minutes >= 5 && minutes <= 480)) return { ok: false, error: "Default length must be 5 minutes to 8 hours." };
  const { error } = await supabaseAdmin.from("crm_settings").upsert({
    id: true,
    meeting_url: meetingUrl,
    meeting_details: clean(input.meetingDetails, 2000),
    from_name: fromName,
    reply_to: replyTo,
    timezone: input.timezone,
    default_minutes: minutes,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't save the settings." };
  refresh();
  return { ok: true, message: "Saved." };
}
