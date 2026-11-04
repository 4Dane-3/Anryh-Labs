"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DateTime } from "luxon";
import {
  CalendarCheck,
  Check,
  CircleCheck,
  Copy,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  MessageSquare,
  Pencil,
  Phone,
  PhoneMissed,
  Send,
  StickyNote,
  Trash2,
  UserRound,
  Voicemail,
  X,
} from "lucide-react";
import type { Client, ClientActivity } from "@/lib/dashboard/clients";
import { phone as formatPhone } from "@/lib/dashboard/format";
import { orderedAnswers } from "@/lib/booking/questions";
import { CLIENT_STATUSES, startsFollowUps, type ClientStatus } from "@/lib/outcomes";
import Link from "next/link";
import { addActivity, cancelBooking, changeClientStatus, editActivity, loadClientActivity, reachOut, removeActivity, saveNotesFor, tapClient } from "@/app/dashboard/actions";
import type { SequenceKey } from "@/lib/email-sequences";
import { Chips, FollowUpMark, Premium } from "@/components/dashboard/OutcomeAsk";
import { Badge, Button, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// One client's card: who they are and how to reach them, where they stand (prospect, current plan, not
// interested), one-tap answers after a call, notes, and everything that happened, newest first. The agent
// adds their own entries (a call attempt, a voicemail, a text, a note) and can edit or delete those; the
// system's entries (emails, answers, what Meta was told) are the record.

/** What the card needs to know about the agent's automated emails. */
export type Emailing = { on: boolean; ready: boolean; sequences: Record<SequenceKey, { on: boolean; total: number }> };

export const SOURCE_LABEL: Record<Client["source"], string> = { instant_form: "Instant form", page: "Quote request", booking: "Booked call", manual: "Added by you" };

/** Who brought them in: Migz (its ads, page and forms) or the agent themself. */
export function originBadge(origin: Client["origin"]) {
  return origin === "migz" ? <Badge tone="accent">Migz</Badge> : <Badge>Personal</Badge>;
}

export function statusBadge(status: ClientStatus) {
  if (status === "current") return <Badge tone="good">Current plan</Badge>;
  if (status === "not_interested") return <Badge tone="bad">Not interested</Badge>;
  return <Badge tone="accent">Prospect</Badge>;
}

const ENTRY_KINDS = [
  { key: "tried_call", label: "Tried to call" },
  { key: "emailed", label: "Sent an email" },
  { key: "voicemail", label: "Left a voicemail" },
  { key: "texted", label: "Texted" },
  { key: "note", label: "Note" },
] as const;

type Entry = ClientActivity | { id: null; kind: "came_in" | "booked"; body: string | null; at: string; byAgent: false };

const ICONS: Record<Entry["kind"], typeof Phone> = {
  tried_call: PhoneMissed,
  emailed: MailCheck,
  voicemail: Voicemail,
  texted: MessageSquare,
  note: StickyNote,
  outcome: CircleCheck,
  status: UserRound,
  email: Mail,
  meta: Send,
  came_in: Inbox,
  booked: CalendarCheck,
};

function entryTitle(e: Entry) {
  switch (e.kind) {
    case "tried_call":
      return "Tried to call";
    case "emailed":
      return "Sent an email";
    case "voicemail":
      return "Left a voicemail";
    case "texted":
      return "Texted";
    case "note":
      return "Note";
    case "outcome":
      return `Marked ${e.body}`;
    case "status":
      return `Moved to ${e.body}`;
    case "email":
      return "Email sent";
    case "meta":
      return `Meta told: ${e.body}`;
    case "came_in":
    case "booked":
      return e.body ?? "";
  }
}
/** Entries whose body is the title itself, so it isn't repeated underneath. */
const BODY_IN_TITLE = new Set(["outcome", "status", "meta", "came_in", "booked"]);

// <input type="datetime-local"> wants local time without a zone
const toLocalInput = (iso: string, tz: string) => DateTime.fromISO(iso).setZone(tz).toFormat("yyyy-LL-dd'T'HH:mm");
const fromLocalInput = (v: string, tz: string) => DateTime.fromFormat(v, "yyyy-LL-dd'T'HH:mm", { zone: tz }).toUTC().toISO() ?? new Date().toISOString();

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
    >
      {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">{children}</h3>;
}

/** Add or edit one of the agent's own entries. */
function EntryForm({
  timezone,
  initial,
  onSave,
  onCancel,
  pending,
}: {
  timezone: string;
  initial?: { kind: string; body: string; at: string };
  onSave: (entry: { kind: string; body: string; at: string }) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "tried_call");
  const [body, setBody] = useState(initial?.body ?? "");
  const [at, setAt] = useState(() => toLocalInput(initial?.at ?? new Date().toISOString(), timezone));
  // A new entry whose time wasn't changed happened just now, not when the card was opened
  const [pickedTime, setPickedTime] = useState(false);
  return (
    <form
      className="space-y-2 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ kind, body, at: initial || pickedTime ? fromLocalInput(at, timezone) : new Date().toISOString() });
        if (!initial) {
          setBody("");
          setPickedTime(false);
          setAt(toLocalInput(new Date().toISOString(), timezone));
        }
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {ENTRY_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setKind(k.key)}
            className={cn(
              "h-7 rounded-full border px-2.5 text-[12px] transition-colors",
              kind === k.key ? "border-brand/60 bg-brand/[0.12] text-fg" : "border-line text-fg-muted hover:text-fg",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        className={inputClass}
        placeholder={kind === "note" ? "What happened, what they said, what's next" : "Details (optional)"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" className={cn(inputClass, "h-8 w-auto py-1 text-[13px]")} value={at} max={toLocalInput(new Date().toISOString(), timezone)} onChange={(e) => {
            setAt(e.target.value);
            setPickedTime(true);
          }} />
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={pending || (kind === "note" && !body.trim())}>
            {initial ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </form>
  );
}

const SEQUENCE_NAME: Record<SequenceKey, string> = { tried_call: "after a missed call", emailed: "after your email" };

function CardBody({ client, timezone, questionOrder, emailing, onClose }: { client: Client; timezone: string; questionOrder: string[]; emailing: Emailing; onClose: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState(client.status);
  const [outcome, setOutcome] = useState(client.outcome);
  const [notes, setNotes] = useState(client.notes ?? "");
  const [savedNotes, setSavedNotes] = useState(client.notes ?? "");
  const [activities, setActivities] = useState<ClientActivity[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const subjects = client.subjects;
  const reload = useCallback(async () => {
    const res = await loadClientActivity(subjects);
    if (res.ok) setActivities(res.activities);
  }, [subjects]);
  useEffect(() => {
    let live = true;
    loadClientActivity(subjects)
      .then((res) => live && setActivities(res.ok ? res.activities : []))
      .catch(() => live && setActivities([]));
    return () => {
      live = false;
    };
  }, [subjects]);

  // Every change: save, refresh the list behind the card and the timeline
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error);
      if (done) {
        setFlash(done);
        setTimeout(() => setFlash(null), 1800);
      }
      await reload();
      router.refresh();
    });

  const tap = (action: string, premium?: number) => {
    // Couldn't reach starts the missed-call emails: the note says what happened to them
    if (startsFollowUps(client.kind, action)) return reach("not_reached");
    setOutcome(action);
    if (action === "sold") setStatus("current");
    if (action === "not_interested") setStatus("not_interested");
    run(() => tapClient(client.kind, client.id, action, premium), "Saved");
  };

  // "Tried to call" / "Sent an email": logged, and the automated emails start; the note says what happened to them
  const [reachNote, setReachNote] = useState<string | null>(null);
  const reach = (action: "tried_call" | "sent_email" | "not_reached") => {
    if (action === "not_reached" || (action === "tried_call" && !outcome && client.kind === "lead")) setOutcome("not_reached");
    setReachNote(null);
    startTransition(async () => {
      setError(null);
      const res = await reachOut(client.kind, client.id, action);
      if (!res.ok) return setError(res.error);
      const what = action === "tried_call" ? "Call attempt logged." : action === "sent_email" ? "Email logged." : "Saved.";
      if (client.origin === "personal") {
        setFlash(what);
        setTimeout(() => setFlash(null), 1800);
      }
      setReachNote(
        res.started
          ? `${what} ${res.sentNow ? "Their first automated email just went out; the rest follow on schedule." : "Their automated emails are scheduled."}`
          : `${what}${res.reason ? ` ${res.reason}` : ""}`,
      );
      await reload();
      router.refresh();
    });
  };

  const pickStatus = (s: ClientStatus) => {
    const before = status;
    setStatus(s);
    if (s === "not_interested") setOutcome("not_interested");
    else if (before === "not_interested" && outcome === "not_interested") setOutcome(null);
    run(() => changeClientStatus(client.kind, client.id, s));
  };

  const call = client.call;
  const callStart = call ? DateTime.fromISO(call.startsAt, { zone: timezone }) : null;
  const upcoming = !!call && call.status === "confirmed" && new Date(call.endsAt) > new Date();
  const answers = call?.answers ? orderedAnswers(call.answers, questionOrder) : [];
  const fmt = (iso: string) => DateTime.fromISO(iso, { zone: timezone }).toFormat("LLL d, h:mm a");

  // The timeline: logged entries plus "came in" and "booked", which the card already knows
  const entries: Entry[] = [
    ...(activities ?? []),
    { id: null, kind: "came_in" as const, byAgent: false as const, body: client.source === "booking" ? "Booked from your page" : client.source === "manual" ? `Added by you${client.cameFrom.includes("·") ? ` (${client.cameFrom.split("·").slice(1).join("·").trim().toLowerCase()})` : ""}` : `Came in from ${SOURCE_LABEL[client.source].toLowerCase()}${client.cameFrom.includes("·") ? ` (${client.cameFrom.split("·").slice(1).join("·").trim()})` : ""}`, at: client.cameInAt },
    ...(call && client.source !== "booking" ? [{ id: null, kind: "booked" as const, body: `Booked a call for ${callStart!.toFormat("ccc, LLL d 'at' h:mm a")}`, at: call.bookedAt, byAgent: false as const }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    const day = DateTime.fromISO(e.at, { zone: timezone }).toFormat("cccc, LLL d");
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }

  return (
    <>
      <div className="border-b border-line px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{client.name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-fg-muted">
              {originBadge(client.origin)}
              <span>
                {client.source === "manual" ? client.cameFrom : SOURCE_LABEL[client.source]} · {client.source === "manual" ? "added" : "came in"} {fmt(client.cameInAt)}
              </span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-white/[0.06] hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <div role="radiogroup" aria-label="Status" className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-white/[0.04] p-1">
          {CLIENT_STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={status === s.key}
              disabled={pending}
              onClick={() => status !== s.key && pickStatus(s.key)}
              className={cn(
                "h-8 rounded-md text-[13px] font-medium transition-colors",
                status === s.key
                  ? s.key === "current"
                    ? "bg-good/15 text-good"
                    : s.key === "not_interested"
                      ? "bg-bad/15 text-bad"
                      : "bg-brand/15 text-brand"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <section className="space-y-1">
          {client.phoneGiven ? (
            <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
              <Phone className="size-4 text-fg-faint" />
              <a href={`tel:${client.phone}`} className="flex-1 text-sm hover:text-brand">
                {/^\+1\d{10}$/.test(client.phone) ? formatPhone(client.phone) : client.phone}
              </a>
              <CopyButton value={client.phone} label="phone number" />
            </div>
          ) : (
            <div className="-mx-2 flex items-center gap-3 px-2 py-1.5">
              <Phone className="size-4 text-fg-faint" />
              <span className="flex-1 text-sm text-fg-muted">No phone given, email only</span>
            </div>
          )}
          {client.email && (
            <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
              <Mail className="size-4 text-fg-faint" />
              <a href={`mailto:${client.email}`} className="flex-1 truncate text-sm hover:text-brand">
                {client.email}
              </a>
              <CopyButton value={client.email} label="email" />
            </div>
          )}
        </section>

        {client.origin === "migz" && (
          <section>
            <SectionTitle>Reached out, no answer yet</SectionTitle>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {client.phoneGiven && (
                  <Button size="sm" variant="ghost" className="border border-line" onClick={() => reach("tried_call")} disabled={pending}>
                    <PhoneMissed className="size-4" /> Tried to call <FollowUpMark />
                  </Button>
                )}
                {client.email && (
                  <Button size="sm" variant="ghost" className="border border-line" onClick={() => reach("sent_email")} disabled={pending}>
                    <MailCheck className="size-4" /> Sent an email
                  </Button>
                )}
              </div>
              <p className="text-[12px] leading-relaxed text-fg-muted">
                {reachNote ? (
                  <span className="text-good">{reachNote}</span>
                ) : client.emailSequence ? (
                  <>
                    Automated emails {SEQUENCE_NAME[client.emailSequence.key]}: {Math.min(client.emailSequence.sent, emailing.sequences[client.emailSequence.key].total)} of {emailing.sequences[client.emailSequence.key].total} sent.
                    They stop when you mark them reached, booked, sold or not interested.
                  </>
                ) : !emailing.on || !emailing.ready ? (
                  <>Logs it on their card. Automated emails are off, so nothing is sent to them.</>
                ) : (
                  <>
                    {client.phoneGiven && client.email
                      ? `Pressing either logs it and starts your automated emails to ${client.name.split(" ")[0]}: one sequence after a missed call, another after you email them.`
                      : `Pressing it logs it and starts your automated emails to ${client.name.split(" ")[0]}${client.phoneGiven ? " after a missed call" : " after you email them"}.`}{" "}
                    {client.kind === "lead" && "Couldn't reach below starts the missed-call emails too (look for the mail icon). "}
                    They stop when you mark them reached, booked, sold or not interested.
                  </>
                )}{" "}
                <Link href="/dashboard/emails" className="font-medium text-brand hover:underline">
                  Change what they say in Automated emails
                </Link>
              </p>
            </div>
          </section>
        )}

        <section>
          <SectionTitle>{client.origin === "migz" ? "After you talk" : "After you call"}</SectionTitle>
          <div className="space-y-3">
            {client.origin === "personal" && client.phoneGiven && (
              <Button size="sm" variant="ghost" className="border border-line" onClick={() => reach("tried_call")} disabled={pending}>
                <PhoneMissed className="size-4" /> Tried to call
              </Button>
            )}
            <Chips kind={client.kind} value={outcome} onPick={(o) => tap(o)} disabled={pending} />
            {outcome === "sold" && <Premium initialCents={client.premiumCents} onSave={(d) => tap("sold", d)} />}
            <p className="min-h-4 text-[12px] text-fg-faint">
              {pending ? <Loader2 className="inline size-3 animate-spin" /> : flash ? <span className="text-good">{flash}</span> : client.origin === "personal"
                  ? "For your own records: personal clients never go to Meta or Migz, and never get automated emails."
                  : "Reached, sold and not interested go to Meta, so your ads find more people like the ones who buy."}
            </p>
          </div>
        </section>

        <section>
          <SectionTitle>Details</SectionTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            {client.coverage && (
              <div>
                <dt className="text-fg-faint">Interested in</dt>
                <dd className="mt-0.5 text-fg">{client.coverage}</dd>
              </div>
            )}
            {client.bestTime && (
              <div>
                <dt className="text-fg-faint">Best time to call</dt>
                <dd className="mt-0.5 text-fg">{client.bestTime}</dd>
              </div>
            )}
            <div className="col-span-2">
              <dt className="text-fg-faint">Came from</dt>
              <dd className="mt-0.5 text-fg">{client.cameFrom}</dd>
            </div>
            {call && callStart && (
              <div className="col-span-2">
                <dt className="text-fg-faint">Call</dt>
                <dd className="mt-0.5 flex items-center gap-2 text-fg">
                  {callStart.toFormat("cccc, LLL d 'at' h:mm a ZZZZ")}
                  {call.status === "cancelled" ? <Badge tone="bad">Cancelled</Badge> : upcoming ? <Badge tone="accent">Upcoming</Badge> : <Badge>Past</Badge>}
                </dd>
              </div>
            )}
            {client.triedEmailSentAt && (
              <div className="col-span-2">
                <dt className="text-fg-faint">Missed-call email</dt>
                <dd className="mt-0.5 text-fg">Sent {fmt(client.triedEmailSentAt)}</dd>
              </div>
            )}
          </dl>
          {call && (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-2 text-[12px] text-fg-faint">
                Prep answers {call.intakeCompleted ? <Badge tone="good">Finished</Badge> : answers.length ? <Badge tone="accent">Partly answered</Badge> : null}
              </p>
              {answers.length ? (
                <dl className="divide-y divide-line rounded-lg border border-line">
                  {answers.map(([key, a]) => (
                    <div key={key} className="px-4 py-3">
                      <dt className="text-[12px] text-fg-muted">{a.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-fg">{a.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[13px] text-fg-muted">They haven&apos;t answered the prep questions yet.</p>
              )}
            </div>
          )}
        </section>

        <section>
          <SectionTitle>Your notes</SectionTitle>
          <textarea rows={4} className={inputClass} placeholder="Only you can see these." value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button
            size="sm"
            className="mt-2"
            disabled={pending || notes === savedNotes}
            onClick={() =>
              run(async () => {
                const res = await saveNotesFor(client.kind, client.id, notes);
                if (res.ok) setSavedNotes(notes);
                return res;
              }, "Notes saved")
            }
          >
            Save notes
          </Button>
        </section>

        <section>
          <SectionTitle>Activity</SectionTitle>
          <EntryForm timezone={timezone} pending={pending} onSave={(entry) => run(() => addActivity(client.kind, client.id, entry), "Added")} />
          {activities === null ? (
            <p className="mt-4 text-[13px] text-fg-faint">
              <Loader2 className="mr-1.5 inline size-3 animate-spin" />
              Loading…
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              {[...byDay.entries()].map(([day, list]) => (
                <div key={day}>
                  <p className="mb-2 text-[12px] font-medium text-fg-faint">{day}</p>
                  <ol className="space-y-1">
                    {list.map((e, i) => {
                      const Icon = ICONS[e.kind];
                      if (e.id && editing === e.id)
                        return (
                          <li key={e.id}>
                            <EntryForm
                              timezone={timezone}
                              pending={pending}
                              initial={{ kind: e.kind, body: e.body ?? "", at: e.at }}
                              onCancel={() => setEditing(null)}
                              onSave={(entry) => {
                                setEditing(null);
                                run(() => editActivity(e.id!, entry));
                              }}
                            />
                          </li>
                        );
                      return (
                        <li key={e.id ?? `${e.kind}-${i}`} className="group -mx-2 flex gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
                          <Icon className={cn("mt-0.5 size-4 shrink-0", e.byAgent ? "text-brand" : "text-fg-faint")} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] text-fg">
                              {entryTitle(e)}
                              <span className="ml-2 font-mono text-[11px] text-fg-faint">{DateTime.fromISO(e.at, { zone: timezone }).toFormat("h:mm a")}</span>
                            </p>
                            {e.body && !BODY_IN_TITLE.has(e.kind) && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-fg-muted">{e.body}</p>}
                          </div>
                          {e.byAgent && e.id && (
                            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              <button type="button" aria-label="Edit entry" onClick={() => setEditing(e.id)} className="rounded-md p-1.5 text-fg-faint hover:bg-white/[0.06] hover:text-fg">
                                <Pencil className="size-3.5" />
                              </button>
                              <button type="button" aria-label="Delete entry" onClick={() => run(() => removeActivity(e.id!))} className="rounded-md p-1.5 text-fg-faint hover:bg-white/[0.06] hover:text-bad">
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>

      {upcoming && (
        <div className="border-t border-line px-6 py-4">
          <AnimatePresence mode="wait" initial={false}>
            {confirmCancel ? (
              <motion.div key="confirm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                <p className="text-[13px] text-fg-muted">
                  Cancel this call? The time opens up again on your page. <span className="text-fg">{client.name.split(" ")[0]} won&apos;t be notified automatically</span>, so let them know yourself.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                    Keep it
                  </Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => cancelBooking(client.id))}>
                    Cancel call
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Button size="sm" variant="danger" className="-ml-3" onClick={() => setConfirmCancel(true)}>
                  Cancel this call
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

export function ClientCard({ client, timezone, questionOrder, emailing, onClose }: { client: Client | null; timezone: string; questionOrder: string[]; emailing: Emailing; onClose: () => void }) {
  useEffect(() => {
    if (!client) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client, onClose]);

  return (
    <AnimatePresence>
      {client && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            key={client.key}
            role="dialog"
            aria-label={`${client.name} details`}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-ink shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            <CardBody client={client} timezone={timezone} questionOrder={questionOrder} emailing={emailing} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
