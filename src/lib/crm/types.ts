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
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: ClientStatus;
  custom: Record<string, CustomValue>; // keyed by CrmColumn.id
  source: "manual" | "csv";
  created_at: string;
  updated_at: string;
  // computed by the list query
  next_meeting?: { starts_at: string; status: MeetingStatus } | null;
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
  created_at: string;
};

export type CalendarMeeting = CrmMeeting & { client: { id: string; name: string; email: string | null } };

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
export type ImportRow = { name: string; email?: string; phone?: string; company?: string; status?: string; note?: string; custom?: Record<string, CustomValue> };

export type Result<T = undefined> = ({ ok: true; message?: string } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };
