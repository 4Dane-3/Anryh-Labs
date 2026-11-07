"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Ban, Copy, Send, Trash2 } from "lucide-react";
import { cancelMeeting, deleteMeeting, saveMeeting } from "@/app/admin/crm/actions";
import { clientLabel, type ClientRef, type CrmMeeting, type CrmSettings } from "@/lib/crm/types";
import { Button, inputClass, Label } from "@/components/dashboard/ui";
import { MeetingBadge, Modal, TIMEZONES } from "@/components/admin/crm/shared";
import { OutcomeDialog } from "@/components/admin/crm/OutcomeDialog";
import { cn } from "@/lib/utils";

export type ClientOption = ClientRef;

type Props = {
  open: boolean;
  onClose: () => void;
  settings: CrmSettings;
  zoom: boolean; // Zoom is connected
  clients?: ClientOption[]; // the picker; omit with `client` to fix the client
  client?: ClientOption;
  meeting?: CrmMeeting | null;
  defaultStart?: string; // ISO, for a slot clicked on the calendar
  appUrl: string;
};

export function MeetingForm(props: Props) {
  const title = props.meeting ? "Meeting" : `New meeting${props.client ? ` with ${clientLabel(props.client)}` : ""}`;
  return (
    <Modal open={props.open} onClose={props.onClose} title={title} wide>
      {props.open && <Form key={props.meeting?.id ?? props.defaultStart ?? "new"} {...props} />}
    </Modal>
  );
}

function Form({ onClose, settings, zoom, clients, client, meeting, defaultStart, appUrl }: Props) {
  const router = useRouter();
  const tz = meeting?.timezone ?? settings.timezone;
  const start = meeting ? DateTime.fromISO(meeting.starts_at).setZone(tz) : defaultStart ? DateTime.fromISO(defaultStart).setZone(tz) : DateTime.now().setZone(tz).plus({ days: 1 }).set({ hour: 10, minute: 0 });
  const [f, setF] = useState({
    clientId: meeting?.client_id ?? client?.id ?? "",
    title: meeting?.title ?? "",
    date: start.toISODate()!,
    time: start.toFormat("HH:mm"),
    minutes: meeting ? Math.round((Date.parse(meeting.ends_at) - Date.parse(meeting.starts_at)) / 60000) : settings.default_minutes,
    timezone: tz,
    meetingUrl: meeting ? (meeting.meeting_url ?? "") : (settings.meeting_url ?? ""),
    meetingDetails: meeting ? (meeting.meeting_details ?? "") : (settings.meeting_details ?? ""),
    description: meeting?.description ?? "",
    zoom: !!meeting?.zoom_meeting_id,
  });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const picked = client ?? clients?.find((c) => c.id === f.clientId);
  const zones = useMemo(() => (TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]), [f.timezone]);
  const live = meeting && meeting.status !== "cancelled";
  const [now] = useState(() => Date.now());
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const canMark = !!meeting && meeting.status !== "cancelled" && meeting.status !== "draft" && Date.parse(meeting.starts_at) <= now;
  const confirmLink = meeting ? `${appUrl}/meet/${meeting.token}` : null;

  const submit = (send: boolean) =>
    start_(async () => {
      setError(null);
      setNote(null);
      const r = await saveMeeting({ id: meeting?.id, ...f, title: f.title || `Meeting with ${(picked ? clientLabel(picked) : null) ?? "client"}`, minutes: Number(f.minutes), send });
      if (!r.ok) return setError(r.error);
      router.refresh();
      if (r.message && send) {
        setNote(r.message);
        setTimeout(onClose, 2200);
      } else onClose();
    });

  return (
    <div className="space-y-4">
      {meeting && canMark && <OutcomeDialog open={outcomeOpen} meetingId={meeting.id} label={picked ? clientLabel(picked) : "them"} onClose={() => setOutcomeOpen(false)} />}
      {meeting && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[12px] text-fg-muted">
          <MeetingBadge meeting={meeting} timezone={settings.timezone} now={now} />
          {meeting.invited_at && <span>invited {DateTime.fromISO(meeting.invited_at).toRelative()}</span>}
          {meeting.confirmed_at && <span className="text-good">confirmed {DateTime.fromISO(meeting.confirmed_at).toRelative()}</span>}
          {meeting.cancelled_at && <span className="text-bad">cancelled by {meeting.cancelled_by === "client" ? "the client" : "you"} {DateTime.fromISO(meeting.cancelled_at).toRelative()}</span>}
          {meeting.nudge_sent_at && <span>nudge sent</span>}
          {meeting.reminder_sent_at && <span>day-before reminder sent</span>}
          {meeting.hour_reminder_sent_at && <span>hour-before reminder sent</span>}
          {meeting.rebook_sent_at && <span>rebook email sent</span>}
          {meeting.reschedule_requested_at && <span className="text-brand">asked for a new time {DateTime.fromISO(meeting.reschedule_requested_at).toRelative()}</span>}
          {canMark && (
            <button type="button" onClick={() => setOutcomeOpen(true)} className="rounded-md border border-brand/40 px-2 py-0.5 text-fg hover:bg-brand/10">
              {meeting.outcome ? "Change what happened" : "Mark what happened"}
            </button>
          )}
          {confirmLink && (
            <button type="button" onClick={() => navigator.clipboard.writeText(confirmLink)} className="ml-auto flex items-center gap-1 hover:text-fg" title={confirmLink}>
              <Copy className="size-3" /> Copy confirm link
            </button>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="m-client">Client</Label>
          {clients && !client && !meeting ? (
            <select id="m-client" className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={f.clientId} onChange={set("clientId")}>
              <option value="">Pick a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {clientLabel(c)}
                  {c.email ? ` · ${c.email}` : " · no email"}
                </option>
              ))}
            </select>
          ) : (
            <p className="py-2 text-sm text-fg">
              {(picked ? clientLabel(picked) : null) ?? "—"} <span className="text-fg-faint">{picked?.email ?? "no email"}</span>
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="m-title">Title</Label>
          <input id="m-title" className={inputClass} value={f.title} onChange={set("title")} placeholder={`Meeting with ${(picked ? clientLabel(picked) : null) ?? "client"}`} maxLength={200} />
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 sm:col-span-2">
          <div>
            <Label htmlFor="m-date">Date</Label>
            <input id="m-date" type="date" className={cn(inputClass, "[color-scheme:dark]")} value={f.date} onChange={set("date")} />
          </div>
          <div>
            <Label htmlFor="m-time">Time</Label>
            <input id="m-time" type="time" step={300} className={cn(inputClass, "[color-scheme:dark]")} value={f.time} onChange={set("time")} />
          </div>
          <div>
            <Label htmlFor="m-min">Length</Label>
            <select id="m-min" className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={f.minutes} onChange={set("minutes")}>
              {[...new Set([15, 20, 30, 45, 60, 90, 120, Number(f.minutes)])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} hr`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="m-tz">Timezone (the email shows the time in this zone)</Label>
          <select id="m-tz" className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={f.timezone} onChange={set("timezone")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")} · {DateTime.now().setZone(z).toFormat("ZZZZ")}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <Label htmlFor="m-url" className="mb-0">
              Meeting link
            </Label>
            {zoom && (
              <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                <input type="checkbox" checked={f.zoom} onChange={(e) => setF({ ...f, zoom: e.target.checked })} className="size-3.5 accent-[var(--color-brand)]" />
                Create a Zoom meeting for it
              </label>
            )}
          </div>
          <input id="m-url" className={inputClass} disabled={f.zoom} value={f.zoom ? "Zoom makes the link when you save" : f.meetingUrl} onChange={set("meetingUrl")} placeholder="https://zoom.us/j/… or https://meet.google.com/…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="m-details">Meeting ID, passcode, dial-in (optional)</Label>
          <textarea id="m-details" rows={2} disabled={f.zoom} className={inputClass} value={f.zoom ? "" : f.meetingDetails} onChange={set("meetingDetails")} placeholder={"Meeting ID: 123 456 7890\nPasscode: 123456"} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="m-desc">Message in the invite (optional)</Label>
          <textarea id="m-desc" rows={3} className={inputClass} value={f.description} onChange={set("description")} placeholder="What we'll cover, anything to bring…" maxLength={4000} />
        </div>
      </div>

      {error && <p className="text-[13px] text-bad">{error}</p>}
      {note && <p className="text-[13px] text-good">{note}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex gap-1">
          {live && (
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => {
                const notify = !!meeting.invited_at && confirm("Email the client that it's cancelled? (Cancel = cancel without emailing)");
                start_(async () => {
                  const r = await cancelMeeting(meeting.id, notify);
                  if (!r.ok) return setError(r.error);
                  setNote(r.message ?? "Cancelled.");
                  router.refresh();
                  setTimeout(onClose, 1500);
                });
              }}
            >
              <Ban /> Cancel meeting
            </Button>
          )}
          {meeting && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this meeting from the calendar? It won't email the client.")) return;
                start_(async () => {
                  await deleteMeeting(meeting.id);
                  router.refresh();
                  onClose();
                });
              }}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit(false)}>
            {meeting ? "Save" : "Save as draft"}
          </Button>
          <Button type="button" variant="primary" disabled={pending || !picked?.email} title={!picked?.email ? "This client has no email" : undefined} onClick={() => submit(true)}>
            <Send /> {pending ? "Sending…" : meeting?.invited_at && meeting.status !== "cancelled" ? "Save & send update" : "Save & send invite"}
          </Button>
        </div>
      </div>
    </div>
  );
}
