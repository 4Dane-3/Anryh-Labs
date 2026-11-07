// The admin CRM's shapes, shared by server code and the /admin client components.

export const CLIENT_STATUSES = ["lead", "contacted", "meeting", "client", "lost"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const STATUS_LABEL: Record<ClientStatus, string> = {
  lead: "Lead",
  contacted: "Contacted",
  meeting: "Meeting set",
  client: "Client",
  lost: "Lost",
};

export const COLUMN_TYPES = ["text", "select", "checkbox", "date", "number"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export const OPTION_COLORS = ["neutral", "accent", "good", "bad"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export type CrmColumn = {
  id: string;
  label: string;
  type: ColumnType;
  options: { value: string; color: OptionColor }[];
  position: number;
};

export type CustomValue = string | number | boolean | null;

export type CrmClient = {
  id: string;
  name: string | null; // the contact person; optional when the client is a company
  email: string | null;
  phone: string | null;
  company: string | null;
  status: ClientStatus;
  custom: Record<string, CustomValue>; // keyed by CrmColumn.id
  source: "manual" | "csv";
  created_at: string;
  updated_at: string;
  // computed by the list query
  next_meeting?: { starts_at: string; status: MeetingStatus; outcome: MeetingOutcome | null } | null;
};

export type CrmNote = { id: number; client_id: string; body: string; author: string; created_at: string };

export const MEETING_STATUSES = ["draft", "invited", "confirmed", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export type CrmMeeting = {
  id: string;
  client_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  meeting_url: string | null;
  meeting_details: string | null;
  description: string | null;
  status: MeetingStatus;
  token: string;
  zoom_meeting_id: string | null;
  sequence: number;
  invited_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: "staff" | "client" | null;
  reminder_sent_at: string | null;
  nudge_sent_at: string | null;
  hour_reminder_sent_at: string | null;
  outcome: MeetingOutcome | null;
  outcome_at: string | null;
  rebook_sent_at: string | null;
  reschedule_requested_at: string | null;
  created_at: string;
};

export const MEETING_OUTCOMES = ["showed", "no_show", "rescheduled"] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

/** After a meeting the client showed up to: what happens next. Each makes a task. */
export const NEXT_STEPS = { proposal: "Send proposal", follow_up: "Follow up", won: "Closed won", lost: "Closed lost" } as const;
export type NextStep = keyof typeof NEXT_STEPS;

/**
 * What staff see for a meeting, worked out from its status, time and outcome:
 * unconfirmed (invited) becomes "call to confirm" on the morning of the meeting (staff timezone), and once
 * it has started, an invited or confirmed meeting with no outcome needs one ("Mark what happened").
 */
export type MeetingPhase = "draft" | "unconfirmed" | "call" | "confirmed" | "cancelled" | "needs_outcome" | "showed" | "no_show" | "rescheduled";

export function meetingPhase(m: { status: MeetingStatus; starts_at: string; outcome?: MeetingOutcome | null }, now: number, staffZone: string): MeetingPhase {
  if (m.status === "cancelled") return "cancelled";
  if (m.outcome) return m.outcome;
  if (m.status === "draft") return "draft";
  const start = Date.parse(m.starts_at);
  if (start <= now) return "needs_outcome";
  if (m.status === "confirmed") return "confirmed";
  return sameDay(start, now, staffZone) ? "call" : "unconfirmed";
}

/** Same calendar day in that timezone. */
export function sameDay(a: number, b: number, zone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(a) === f.format(b);
}

/** yyyy-MM-dd for today (plus `days`) in that timezone. */
export function dayIn(zone: string, now: number, days = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now + days * 86_400_000);
}

export type CrmTask = {
  id: string;
  client_id: string;
  meeting_id: string | null;
  title: string;
  due_on: string; // yyyy-MM-dd
  done_at: string | null;
  created_by: string | null;
  created_at: string;
};
export type DueTask = CrmTask & { client: ClientRef };

export type ClientRef = { id: string; name: string | null; company: string | null; email: string | null };
export type CalendarMeeting = CrmMeeting & { client: ClientRef };

/** What a client is called in lists and titles: the contact's name, or the company when there's no contact. */
export const clientLabel = (c: { name: string | null; company?: string | null }) => c.name?.trim() || c.company?.trim() || "Unnamed client";
/** How an email greets them: the contact's first name, or nothing personal for a company-only client. */
export const clientFirstName = (c: { name: string | null }) => c.name?.trim().split(/\s+/)[0] || null;

export type CrmSettings = {
  meeting_url: string | null;
  meeting_details: string | null;
  from_name: string;
  reply_to: string | null;
  timezone: string;
  default_minutes: number;
};

export const DEFAULT_SETTINGS: CrmSettings = {
  meeting_url: null,
  meeting_details: null,
  from_name: "Anryh Labs",
  reply_to: null,
  timezone: "America/Los_Angeles",
  default_minutes: 30,
};

/** The fields a CSV column can map to: a built-in field, an existing custom column, or skip. */
export type ImportRow = { name?: string; email?: string; phone?: string; company?: string; status?: string; note?: string; custom?: Record<string, CustomValue> };

export type Result<T = undefined> = ({ ok: true; message?: string } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };
