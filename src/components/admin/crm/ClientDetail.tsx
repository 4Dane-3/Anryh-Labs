"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft, CalendarPlus, Mail, Pencil, Phone, Trash2, Video } from "lucide-react";
import { addNote, deleteClient, deleteNote, setClientField } from "@/app/admin/crm/actions";
import { CLIENT_STATUSES, clientLabel, STATUS_LABEL, type ClientStatus, type CrmClient, type CrmColumn, type CrmMeeting, type CrmNote, type CrmSettings } from "@/lib/crm/types";
import { Button, EmptyState, inputClass, Panel, PanelHeader } from "@/components/dashboard/ui";
import { CustomCell } from "@/components/admin/crm/CustomCell";
import { ClientForm } from "@/components/admin/crm/ClientForm";
import { ColumnEditor } from "@/components/admin/crm/ColumnEditor";
import { MeetingForm } from "@/components/admin/crm/MeetingForm";
import { MeetingBadge, selectClass, STATUS_TONE } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

const TONE_TEXT = { neutral: "text-fg", accent: "text-brand", good: "text-good", bad: "text-bad" } as const;

export function ClientDetail({ client, notes, meetings, columns, settings, zoom, appUrl }: { client: CrmClient; notes: CrmNote[]; meetings: CrmMeeting[]; columns: CrmColumn[]; settings: CrmSettings; zoom: boolean; appUrl: string }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "edit" | "meeting" | "column">(null);
  const [openMeeting, setOpenMeeting] = useState<CrmMeeting | null>(null);
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [pending, start] = useTransition();
  const [now] = useState(() => Date.now());
  const upcoming = meetings.filter((m) => Date.parse(m.ends_at) >= now).reverse();
  const past = meetings.filter((m) => Date.parse(m.ends_at) < now);
  const fmt = (iso: string, zone: string) => DateTime.fromISO(iso).setZone(zone);
  const opt = { id: client.id, name: client.name, company: client.company, email: client.email };
  const label = clientLabel(client);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/clients" className="inline-flex items-center gap-1 text-[13px] text-fg-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> Clients
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{label}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
              {client.name && client.company && <span>{client.company}</span>}
              {!client.name && <span className="text-fg-faint">No contact yet</span>}
              {client.email && (
                <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1 hover:text-fg">
                  <Mail className="size-3.5" /> {client.email}
                </a>
              )}
              {client.phone && (
                <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-fg">
                  <Phone className="size-3.5" /> {client.phone}
                </a>
              )}
              <span className="font-mono text-[11px] text-fg-faint">added {fmt(client.created_at, settings.timezone).toFormat("LLL d, yyyy")}{client.source === "csv" ? " from a CSV" : ""}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setModal("edit")}>
              <Pencil /> Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete ${label}, with their notes and meetings? This can't be undone.`)) return;
                start(async () => {
                  await deleteClient(client.id);
                  router.push("/admin/clients");
                });
              }}
            >
              <Trash2 /> Delete
            </Button>
            <Button size="sm" variant="primary" onClick={() => setModal("meeting")}>
              <CalendarPlus /> Schedule meeting
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Details" action={<button onClick={() => setModal("column")} className="text-[12px] text-fg-muted hover:text-fg">+ Add column</button>} />
            <dl className="divide-y divide-line text-[13px]">
              <div className="grid grid-cols-[130px_1fr] items-center gap-3 px-5 py-2">
                <dt className="text-fg-muted">Status</dt>
                <dd>
                  <select
                    aria-label="Status"
                    value={status}
                    onChange={(e) => {
                      const v = e.target.value as ClientStatus;
                      setStatus(v);
                      start(async () => {
                        const r = await setClientField(client.id, "status", v);
                        if (!r.ok) setStatus(client.status);
                      });
                    }}
                    className={cn(selectClass, "w-full", TONE_TEXT[STATUS_TONE[status]])}
                  >
                    {CLIENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              {columns.map((col) => (
                <div key={col.id} className="grid grid-cols-[130px_1fr] items-center gap-3 px-5 py-2">
                  <dt className="truncate text-fg-muted">{col.label}</dt>
                  <dd>
                    <CustomCell clientId={client.id} column={col} value={client.custom[col.id]} />
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="Meetings" action={<button onClick={() => setModal("meeting")} className="text-[12px] text-fg-muted hover:text-fg">+ Schedule</button>} />
            {meetings.length === 0 ? (
              <EmptyState title="No meetings yet">Schedule one and they get an email with a Confirm button and a calendar invite.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {[...upcoming, ...past].map((m) => {
                  const s = fmt(m.starts_at, settings.timezone);
                  const isPast = Date.parse(m.ends_at) < now;
                  return (
                    <li key={m.id}>
                      <button onClick={() => setOpenMeeting(m)} className={cn("flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-white/[0.02]", isPast && "opacity-60")}>
                        <div className="w-12 shrink-0 text-center">
                          <p className="font-mono text-[10px] uppercase text-fg-faint">{s.toFormat("LLL")}</p>
                          <p className="text-lg font-semibold leading-tight">{s.toFormat("d")}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-fg">{m.title}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-muted">
                            {s.toFormat("ccc h:mm a ZZZZ")}
                            {m.meeting_url && <Video className="size-3" />}
                          </p>
                        </div>
                        <MeetingBadge status={m.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <Notes clientId={client.id} notes={notes} timezone={settings.timezone} />
      </div>

      <ClientForm open={modal === "edit"} onClose={() => setModal(null)} client={client} />
      <ColumnEditor open={modal === "column"} onClose={() => { setModal(null); router.refresh(); }} />
      <MeetingForm open={modal === "meeting" || !!openMeeting} onClose={() => { setModal(null); setOpenMeeting(null); }} settings={settings} zoom={zoom} client={opt} meeting={openMeeting} appUrl={appUrl} />
    </div>
  );
}

function Notes({ clientId, notes, timezone }: { clientId: string; notes: CrmNote[]; timezone: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await addNote(clientId, body);
      if (!r.ok) return setError(r.error);
      setBody("");
      router.refresh();
    });
  return (
    <Panel className="self-start">
      <PanelHeader title="Notes" description="Calls, what they said, what to do next. Newest first." />
      <div className="border-b border-line px-5 py-4">
        <textarea
          aria-label="New note"
          rows={3}
          className={inputClass}
          placeholder="Add a note… (⌘↵ to save)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) submit();
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          {error ? <p className="text-[13px] text-bad">{error}</p> : <span />}
          <Button size="sm" variant="primary" disabled={pending || !body.trim()} onClick={submit}>
            {pending ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <EmptyState title="No notes yet" />
      ) : (
        <ol className="divide-y divide-line">
          {notes.map((n) => {
            const at = DateTime.fromISO(n.created_at).setZone(timezone);
            return (
              <li key={n.id} className="group px-5 py-3.5">
                <div className="flex items-center gap-2 font-mono text-[11px] text-fg-faint">
                  <span className="truncate">{n.author}</span>
                  <span title={at.toFormat("ccc, LLL d yyyy, h:mm a ZZZZ")}>· {at.toFormat("LLL d, yyyy · h:mm a")}</span>
                  <button
                    aria-label="Delete note"
                    className="ml-auto rounded p-1 opacity-0 hover:bg-white/[0.06] hover:text-bad group-hover:opacity-100"
                    onClick={() => {
                      if (!confirm("Delete this note?")) return;
                      start(async () => {
                        await deleteNote(n.id, clientId);
                        router.refresh();
                      });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg">{n.body}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
