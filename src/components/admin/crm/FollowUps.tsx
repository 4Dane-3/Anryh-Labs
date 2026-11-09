"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Eye, Mail, Pause, Play, Send, Settings2, Square } from "lucide-react";
import { changeFollowUp, previewFollowUp, saveFollowUpCopy, sendFollowUpNow, setFollowUpState, startFollowUps } from "@/app/admin/crm/followup-actions";
import { blockedReason, CADENCES, type Cadence, type CrmFollowUp, type CrmFollowUpEmail, type FollowUpCopy } from "@/lib/crm/followups";
import type { CrmClient } from "@/lib/crm/types";
import { Badge, Button, inputClass, Label, Panel, PanelHeader } from "@/components/dashboard/ui";
import { Modal } from "@/components/admin/crm/shared";
import { cn } from "@/lib/utils";

const CADENCE_KEYS = Object.keys(CADENCES) as Cadence[];
const STATUS_BADGE = { active: { tone: "good", label: "On" }, paused: { tone: "accent", label: "Paused" }, stopped: { tone: "bad", label: "Stopped" }, finished: { tone: "neutral", label: "Finished" } } as const;

/** How often + how many + first email now: shared by the client panel and the bulk start in the list. */
function StartFields({ cadence, setCadence, max, setMax, now, setNow, many }: { cadence: Cadence; setCadence: (c: Cadence) => void; max: number; setMax: (n: number) => void; now: boolean; setNow: (b: boolean) => void; many?: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>How often</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {CADENCE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCadence(k)}
              className={cn("rounded-lg border px-2 py-2 text-[13px] transition-colors", cadence === k ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
            >
              {CADENCES[k].label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-fg-faint">Emails go out at 9:00 AM on weekdays. A weekend send moves to Monday.</p>
      </div>
      <div className="grid grid-cols-[110px_1fr] items-center gap-3">
        <Label htmlFor="fu-max" className="mb-0">Emails in total</Label>
        <input id="fu-max" type="number" min={1} max={30} className={cn(inputClass, "w-24")} value={max} onChange={(e) => setMax(Number(e.target.value))} />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-fg-muted">
        <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} className="size-3.5 accent-[var(--color-brand)]" />
        {many ? "Send the first emails now (within 15 minutes)" : "Send the first email now"}
        {!now && <span className="text-fg-faint">· otherwise the next weekday at 9:00 AM</span>}
      </label>
    </div>
  );
}

export function FollowUpPanel({ client, followUp, emails, hasUpcomingMeeting, copy, timezone }: { client: CrmClient; followUp: CrmFollowUp | null; emails: CrmFollowUpEmail[]; hasUpcomingMeeting: boolean; copy: FollowUpCopy & { ready: boolean }; timezone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cadence, setCadence] = useState<Cadence>(followUp?.cadence ?? "every_2_days");
  const [max, setMax] = useState(followUp?.max_emails ?? 6);
  const [now, setNow] = useState(true);
  const [preview, setPreview] = useState(false);
  const [editCopy, setEditCopy] = useState(false);
  const blocked = blockedReason(client, hasUpcomingMeeting);
  const live = followUp && (followUp.status === "active" || followUp.status === "paused");
  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(timezone).toFormat("ccc, LLL d · h:mm a");
  const act = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error });
      router.refresh();
    });

  return (
    <Panel>
      <PanelHeader
        title="Follow-up emails"
        description="A check-in that recaps your offer and process and asks if they'd like to talk."
        action={
          <div className="flex items-center gap-3">
            <button onClick={() => setPreview(true)} className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-fg-muted hover:text-fg">
              <Eye className="size-3.5" /> Preview
            </button>
            <button onClick={() => setEditCopy(true)} className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-fg-muted hover:text-fg">
              <Settings2 className="size-3.5" /> Edit email
            </button>
          </div>
        }
      />
      <div className="space-y-4 px-5 py-4 text-[13px]">
        {!copy.ready && <p className="rounded-lg bg-bad/10 px-3 py-2 text-bad">Run migration 20261206000000_crm_follow_up_emails.sql to turn follow-ups on.</p>}
        {followUp && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={STATUS_BADGE[followUp.status].tone}>{STATUS_BADGE[followUp.status].label}</Badge>
            <span className="text-fg">{CADENCES[followUp.cadence].label}</span>
            <span className="text-fg-muted">
              {followUp.sent_count} of {followUp.max_emails} sent
            </span>
            {followUp.status === "active" && followUp.next_send_at && <span className="text-fg-muted">· next {fmt(followUp.next_send_at)}</span>}
            {followUp.stop_reason && followUp.status !== "active" && <span className="text-fg-faint">· {followUp.stop_reason}</span>}
          </div>
        )}

        {live ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>How often</Label>
                <select className={cn(inputClass, "w-auto [&>option]:bg-[#26282a]")} value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                  {CADENCE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {CADENCES[k].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="fu-max2">Emails in total</Label>
                <input id="fu-max2" type="number" min={1} max={30} className={cn(inputClass, "w-24")} value={max} onChange={(e) => setMax(Number(e.target.value))} />
              </div>
              {(cadence !== followUp!.cadence || max !== followUp!.max_emails) && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => changeFollowUp(client.id, { cadence, maxEmails: max }))}>
                  Save
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {followUp!.status === "active" ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => setFollowUpState(client.id, "pause"))}>
                  <Pause /> Pause
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled={pending || !!blocked} onClick={() => act(() => setFollowUpState(client.id, "resume"))}>
                  <Play /> Resume
                </Button>
              )}
              {followUp!.status === "active" && (
                <Button size="sm" variant="ghost" disabled={pending || !!blocked} onClick={() => act(() => sendFollowUpNow(client.id))}>
                  <Send /> Send the next one now
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Stop follow-up emails for this client?") && act(() => setFollowUpState(client.id, "stop"))}>
                <Square /> Stop
              </Button>
            </div>
            <p className="text-[12px] text-fg-faint">Stops on its own when they unsubscribe, get a meeting, or you mark them a client or lost. If they reply, press Stop.</p>
          </>
        ) : blocked ? (
          <p className="text-fg-muted">Follow-ups can&apos;t start: {blocked.toLowerCase()}.</p>
        ) : (
          <>
            <StartFields cadence={cadence} setCadence={setCadence} max={max} setMax={setMax} now={now} setNow={setNow} />
            <Button size="sm" variant="primary" disabled={pending || !copy.ready} onClick={() => act(() => startFollowUps({ clientIds: [client.id], cadence, maxEmails: max, sendFirstNow: now }))}>
              <Mail /> {pending ? "Starting…" : followUp ? "Start again" : "Start follow-ups"}
            </Button>
          </>
        )}

        {msg && <p className={cn("text-[13px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</p>}

        {emails.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-faint">Sent</p>
            <ol className="divide-y divide-line rounded-lg border border-line">
              {emails.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="font-mono text-[11px] text-fg-faint">#{e.step}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{e.subject}</span>
                  {e.outcome !== "sent" && <Badge tone={e.outcome === "failed" ? "bad" : "neutral"}>{e.outcome === "failed" ? "Failed" : "Logged (dev)"}</Badge>}
                  <span className="whitespace-nowrap font-mono text-[11px] text-fg-faint" title={e.error ?? undefined}>
                    {DateTime.fromISO(e.sent_at).setZone(timezone).toFormat("LLL d, h:mm a")}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <PreviewModal open={preview} onClose={() => setPreview(false)} clientId={client.id} total={followUp?.max_emails ?? max} startStep={Math.min((followUp?.sent_count ?? 0) + 1, followUp?.max_emails ?? max)} />
      <FollowUpCopyForm open={editCopy} onClose={() => setEditCopy(false)} copy={copy} />
    </Panel>
  );
}

/** The email as it'll look, step by step (each opens differently; the last asks whether to keep in touch). */
export function PreviewModal({ open, onClose, clientId, total, startStep = 1, copy }: { open: boolean; onClose: () => void; clientId?: string; total: number; startStep?: number; copy?: { offer: string; process: string; ctaUrl: string; ctaLabel: string; postalAddress: string } }) {
  const [step, setStep] = useState(startStep);
  const [mail, setMail] = useState<{ subject: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyKey = JSON.stringify(copy ?? null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    previewFollowUp({ clientId, step, total, copy }).then((r) => {
      if (!live) return;
      if (r.ok) setMail({ subject: r.subject, html: r.html });
      else setError(r.error);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, total, clientId, copyKey]);
  return (
    <Modal open={open} onClose={onClose} title="Follow-up email preview" wide>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {Array.from({ length: Math.min(total, 10) }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={() => setStep(n)} className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", n === step ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:text-fg")}>
            #{n}
          </button>
        ))}
        {total > 10 && <span className="text-[12px] text-fg-faint">…{total} in all</span>}
      </div>
      {error ? (
        <p className="text-[13px] text-bad">{error}</p>
      ) : mail ? (
        <>
          <p className="mb-2 text-[13px]">
            <span className="text-fg-faint">Subject:</span> <span className="text-fg">{mail.subject}</span>
          </p>
          <iframe title="Email preview" srcDoc={mail.html} className="h-[560px] w-full rounded-lg border border-line bg-white" sandbox="allow-same-origin" />
        </>
      ) : (
        <p className="text-[13px] text-fg-muted">Loading…</p>
      )}
    </Modal>
  );
}

/** What every follow-up says: the offer, the process steps, the button, and the postal address. */
export function FollowUpCopyForm({ open, onClose, copy }: { open: boolean; onClose: () => void; copy: FollowUpCopy }) {
  const router = useRouter();
  const [f, setF] = useState({ offer: copy.offer, process: copy.process, ctaUrl: copy.ctaUrl ?? "", ctaLabel: copy.ctaLabel, postalAddress: copy.postalAddress ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Follow-up email" wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await saveFollowUpCopy(f);
            if (!r.ok) return setError(r.error);
            router.refresh();
            onClose();
          });
        }}
      >
        <div>
          <Label htmlFor="fc-offer">Your offer</Label>
          <textarea id="fc-offer" rows={6} className={inputClass} value={f.offer} onChange={set("offer")} />
          <p className="mt-1 text-[12px] text-fg-faint">Shows under “What we do”. A blank line starts a new paragraph; a paragraph with “guarantee” in it is bold.</p>
        </div>
        <div>
          <Label htmlFor="fc-process">Your process, one step a line</Label>
          <textarea id="fc-process" rows={6} className={cn(inputClass, "font-mono text-[12px]")} value={f.process} onChange={set("process")} />
          <p className="mt-1 text-[12px] text-fg-faint">“Title: what happens” on each line becomes a numbered step.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <div>
            <Label htmlFor="fc-url">Button link (optional)</Label>
            <input id="fc-url" className={inputClass} value={f.ctaUrl} onChange={set("ctaUrl")} placeholder="Your booking page, e.g. a Calendly link" />
          </div>
          <div>
            <Label htmlFor="fc-label">Button text</Label>
            <input id="fc-label" className={inputClass} value={f.ctaLabel} onChange={set("ctaLabel")} />
          </div>
        </div>
        <div>
          <Label htmlFor="fc-addr">Mailing address</Label>
          <input id="fc-addr" className={inputClass} value={f.postalAddress} onChange={set("postalAddress")} placeholder="Street, city, state ZIP" />
          <p className={cn("mt-1 text-[12px]", f.postalAddress.trim() ? "text-fg-faint" : "text-bad")}>US law (CAN-SPAM) requires a physical mailing address in sales emails. It goes in the footer next to Unsubscribe.</p>
        </div>
        {error && <p className="text-[13px] text-bad">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => setPreview(true)}>
            <Eye /> Preview
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
      <PreviewModal open={preview} onClose={() => setPreview(false)} total={6} copy={f} />
    </Modal>
  );
}

/** Start follow-ups for the clients selected in the list. */
export function BulkFollowUp({ open, onClose, clientIds, onDone }: { open: boolean; onClose: () => void; clientIds: string[]; onDone: (message: string) => void }) {
  const [cadence, setCadence] = useState<Cadence>("every_2_days");
  const [max, setMax] = useState(6);
  const [now, setNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal open={open} onClose={onClose} title={`Start follow-ups for ${clientIds.length} client${clientIds.length === 1 ? "" : "s"}`}>
      <div className="space-y-4">
        <StartFields cadence={cadence} setCadence={setCadence} max={max} setMax={setMax} now={now} setNow={setNow} many />
        <p className="text-[12px] text-fg-faint">Anyone with no email, who unsubscribed, has a meeting, or is a client or lost is skipped. Starting again restarts a client&apos;s sequence from email #1.</p>
        {error && <p className="text-[13px] text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await startFollowUps({ clientIds, cadence, maxEmails: max, sendFirstNow: now });
                if (!r.ok) return setError(r.error);
                onDone(r.message ?? "Started.");
              })
            }
          >
            <Mail /> {pending ? "Starting…" : "Start follow-ups"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
