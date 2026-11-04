"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Loader2, MailCheck, PhoneMissed, Plus, RotateCcw, Trash2 } from "lucide-react";
import { saveEmailSequences, setFollowUpEmails } from "@/app/dashboard/actions";
import {
  defaultSequences,
  fillPlaceholders,
  MAX_AFTER_DAYS,
  MAX_BODY,
  MAX_EMAILS,
  MAX_SUBJECT,
  SEQUENCES,
  type EmailSequences,
  type Sequence,
  type SequenceKey,
} from "@/lib/email-sequences";
import { Button, Label, Panel, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// The Automated emails tab: the two sequences a lead gets after the agent taps "Tried to call" or "Sent an
// email" on their card. Each email has a subject, a body and when it goes; the agent can add, remove and
// reword them. Saved together; the switch at the top turns all of it on or off.

const ICON: Record<SequenceKey, typeof PhoneMissed> = { tried_call: PhoneMissed, emailed: MailCheck };

function Preview({ subject, body, agentName }: { subject: string; body: string; agentName: string }) {
  const v = { firstName: "Linda", yourName: agentName, link: "yourpage.com/book" };
  const text = body.includes("{booking_link}") ? body : `${body.trim()}\n\nPick a time that suits you: {booking_link}`;
  return (
    <div className="rounded-lg border border-line bg-white/[0.03] px-4 py-3 text-[13px]">
      <p className="text-fg-faint">Subject</p>
      <p className="mb-3 font-medium text-fg">{fillPlaceholders(subject, v)}</p>
      <p className="whitespace-pre-line leading-relaxed text-fg-muted">{fillPlaceholders(text, v)}</p>
      <p className="mt-3 whitespace-pre-line text-fg-muted">{agentName}{"\n"}Licensed insurance broker</p>
      <p className="mt-3 text-[11px] text-fg-faint">You&apos;re getting this because you asked for a life insurance quote. To stop emails, reply &quot;unsubscribe&quot;. Your business name and address</p>
    </div>
  );
}

function SequenceEditor({ k, value, onChange, agentName }: { k: SequenceKey; value: Sequence; onChange: (s: Sequence) => void; agentName: string }) {
  const meta = SEQUENCES.find((s) => s.key === k)!;
  const Icon = ICON[k];
  const [previewing, setPreviewing] = useState<number | null>(null);
  const setEmail = (i: number, patch: Partial<Sequence["emails"][number]>) => onChange({ ...value, emails: value.emails.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const remove = (i: number) => {
    const emails = value.emails.filter((_, j) => j !== i);
    // The new first email can't wait "0 days after the last email"
    onChange({ ...value, emails: emails.map((e, j) => (j === 0 ? e : { ...e, afterDays: Math.max(1, e.afterDays) })) });
  };

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon className="size-4 text-brand" /> {meta.title}
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {meta.trigger} on someone&apos;s card in <Link href="/dashboard/clients" className="text-fg underline-offset-4 hover:underline">Clients</Link>. {value.emails.length} email{value.emails.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Switch checked={value.on} onChange={(on) => onChange({ ...value, on })} label={meta.title} />
      </div>

      <ol className={cn("divide-y divide-line", !value.on && "opacity-50")}>
        {value.emails.map((e, i) => (
          <li key={i} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] font-semibold text-fg">Email {i + 1}</p>
              <div className="flex items-center gap-2 text-[13px] text-fg-muted">
                <span>Send</span>
                {i === 0 ? (
                  <select
                    aria-label={`When email ${i + 1} goes`}
                    className={cn(inputClass, "h-8 w-auto py-0")}
                    value={e.afterDays === 0 ? "now" : "later"}
                    onChange={(ev) => setEmail(i, { afterDays: ev.target.value === "now" ? 0 : Math.max(1, e.afterDays) || 1 })}
                  >
                    <option value="now">right away</option>
                    <option value="later">later</option>
                  </select>
                ) : null}
                {(i > 0 || e.afterDays > 0) && (
                  <>
                    <input
                      aria-label={`Days before email ${i + 1}`}
                      type="number"
                      min={1}
                      max={MAX_AFTER_DAYS}
                      className={cn(inputClass, "h-8 w-16 py-0 tabular-nums")}
                      value={e.afterDays}
                      onChange={(ev) => setEmail(i, { afterDays: Math.min(MAX_AFTER_DAYS, Math.max(1, Math.round(Number(ev.target.value) || 1))) })}
                    />
                    <span>
                      day{e.afterDays === 1 ? "" : "s"} after {i === 0 ? "you tap" : "the last email"}
                    </span>
                  </>
                )}
                <button type="button" onClick={() => setPreviewing(previewing === i ? null : i)} className="rounded-md p-1.5 text-fg-faint hover:bg-white/[0.06] hover:text-fg" aria-label={`Preview email ${i + 1}`}>
                  <Eye className="size-4" />
                </button>
                {value.emails.length > 1 && (
                  <button type="button" onClick={() => remove(i)} className="rounded-md p-1.5 text-fg-faint hover:bg-bad/10 hover:text-bad" aria-label={`Remove email ${i + 1}`}>
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor={`${k}-${i}-subject`}>Subject</Label>
              <input id={`${k}-${i}-subject`} className={inputClass} maxLength={MAX_SUBJECT} value={e.subject} onChange={(ev) => setEmail(i, { subject: ev.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${k}-${i}-body`}>Message</Label>
              <textarea id={`${k}-${i}-body`} rows={7} className={cn(inputClass, "leading-relaxed")} maxLength={MAX_BODY} value={e.body} onChange={(ev) => setEmail(i, { body: ev.target.value })} />
            </div>
            {previewing === i && <Preview subject={e.subject} body={e.body} agentName={agentName} />}
          </li>
        ))}
      </ol>
      {value.emails.length < MAX_EMAILS && (
        <div className="border-t border-line px-5 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...value, emails: [...value.emails, { afterDays: 3, subject: "Checking in, {first_name}", body: "Hi {first_name},\n\n\n\nPick a time that works for you: {booking_link}" }] })}
          >
            <Plus /> Add a follow-up email
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function AutomatedEmails({ initial, on: initialOn, ready, agentName }: { initial: EmailSequences; on: boolean; ready: boolean; agentName: string }) {
  const router = useRouter();
  const [seqs, setSeqs] = useState(initial);
  const [on, setOn] = useState(initialOn);
  const [message, setMessage] = useState<{ good: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(seqs) !== JSON.stringify(initial);

  const toggle = (next: boolean) =>
    start(async () => {
      setOn(next);
      setMessage(null);
      const res = await setFollowUpEmails(next);
      if (!res.ok) {
        setOn(!next);
        setMessage({ good: false, text: res.error });
      }
      router.refresh();
    });

  const save = () =>
    start(async () => {
      setMessage(null);
      const res = await saveEmailSequences(seqs);
      setMessage(res.ok ? { good: true, text: "Saved. New emails go out with these words from now on." } : { good: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <div className="max-w-3xl space-y-3">
      <Panel>
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-fg">Automated emails</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
              Short, plain notes from you, written to land in their main inbox. Nothing goes out until you tap <span className="text-fg">Tried to call</span> or{" "}
              <span className="text-fg">Sent an email</span> on someone&apos;s card, and they stop as soon as you mark them reached, booked, sold or not interested. Emails that wait go
              out between 9am and 6pm your time.
            </p>
            <p className="mt-2 text-[12px] text-fg-faint">
              Use {"{first_name}"}, {"{your_name}"} and {"{booking_link}"} in any email. Your name, title and an unsubscribe line with your business address are added at the
              bottom of every one.
            </p>
            {!ready && <p className="mt-2 text-[13px] text-brand">Emails to leads aren&apos;t set up for your account yet (they need a sending address and a postal address). Ask Anryh Labs to turn them on.</p>}
          </div>
          <Switch checked={on} onChange={toggle} label="Automated emails" disabled={pending} />
        </div>
      </Panel>

      <div className={cn("space-y-3", !on && "opacity-60")}>
        {SEQUENCES.map(({ key }) => (
          <SequenceEditor key={key} k={key} value={seqs[key]} onChange={(s) => setSeqs({ ...seqs, [key]: s })} agentName={agentName} />
        ))}
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-ink/80 px-5 py-3 backdrop-blur-xl">
        <Button variant="primary" onClick={save} disabled={pending || !dirty}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save emails
        </Button>
        <Button variant="ghost" onClick={() => setSeqs(defaultSequences())} disabled={pending}>
          <RotateCcw /> Back to the defaults
        </Button>
        {message && <p className={cn("text-[13px]", message.good ? "text-good" : "text-bad")}>{message.text}</p>}
        {!message && dirty && <p className="text-[13px] text-fg-muted">Unsaved changes</p>}
      </div>
    </div>
  );
}
