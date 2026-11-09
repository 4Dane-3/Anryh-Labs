"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";
import { Check, Copy, Gift, Hammer, Loader2, PhoneCall } from "lucide-react";
import { jobDone, saveCheckinSettings, setGiftCardSent, setReferralStatus } from "@/app/dashboard/actions";
import { Badge, Button, EmptyState, Label, Panel, PanelHeader, Switch, inputClass } from "@/components/dashboard/ui";
import { phone as formatPhone } from "@/lib/dashboard/format";
import type { GiftCardItem, ReferralListItem } from "@/lib/roofing/referrals";
import { cn } from "@/lib/utils";

// Post-job: "Job done" on a booked inspection (it starts the check-in call), the Referrals tab (referred people
// to call by hand, gift cards owed), and the Settings panel for check-in calls and the reward.

type Job = { doneAt: string; checkin: string | null; nextCallAt: string | null; rating: number | null; feedback: string | null; referralEmailAt: string | null };

const CHECKIN_LABEL: Record<string, { text: string; tone: "neutral" | "accent" | "good" | "bad" }> = {
  scheduled: { text: "Check-in call scheduled", tone: "accent" },
  calling: { text: "Check-in call in progress", tone: "accent" },
  went_well: { text: "Went well", tone: "good" },
  issue: { text: "Raised a problem", tone: "bad" },
  callback: { text: "Wants a call from you", tone: "accent" },
  no_answer: { text: "No answer to the check-in", tone: "neutral" },
  do_not_call: { text: "Asked not to be called", tone: "neutral" },
  email_only: { text: "Emailed (no call)", tone: "neutral" },
  failed: { text: "Check-in call didn't start", tone: "neutral" },
};

/** On a booked inspection's card, once its time has passed: "Job done", then how the check-in went. */
export function JobDoneSection({ bookingId, job, timezone, past }: { bookingId: string; job: Job | null | undefined; timezone: string; past: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fmt = (iso: string) => DateTime.fromISO(iso, { zone: timezone }).toFormat("ccc LLL d, h:mm a");

  const markDone = () =>
    startTransition(async () => {
      setError(null);
      const res = await jobDone(bookingId);
      if (!res.ok) return setError(res.error);
      setNote(res.status === "scheduled" && res.callAt ? `Your AI assistant will call to check in ${fmt(res.callAt)}.` : `No check-in call (${res.reason}). The thank-you and referral email went instead, if they have an email.`);
      router.refresh();
    });

  if (!job) {
    if (!past) return null;
    return (
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">After the job</h3>
        <Button size="sm" variant="ghost" className="border border-line" onClick={markDone} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />} Job done
        </Button>
        <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">
          {note ?? "About 2 hours later your AI assistant calls to check in (8am to 8pm, if they agreed to AI calls). If it went well, they're emailed a link to refer friends for a gift card; if not, you're alerted right away."}
        </p>
        {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
      </section>
    );
  }

  const label = job.checkin ? CHECKIN_LABEL[job.checkin] : null;
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">After the job</h3>
      <div className="space-y-1.5 text-[13px] text-fg-muted">
        <p className="flex flex-wrap items-center gap-2">
          <span>Job done {fmt(job.doneAt)}</span>
          {label && <Badge tone={label.tone}>{label.text}</Badge>}
          {job.rating && <Badge tone={job.rating >= 4 ? "good" : job.rating <= 2 ? "bad" : "neutral"}>{job.rating}/5</Badge>}
        </p>
        {job.checkin === "scheduled" && job.nextCallAt && <p className="flex items-center gap-1.5"><PhoneCall className="size-3.5" /> Calls {fmt(job.nextCallAt)}</p>}
        {job.feedback && <p className="text-fg">“{job.feedback}”</p>}
        {job.referralEmailAt && <p>Referral email sent {fmt(job.referralEmailAt)}.</p>}
      </div>
    </section>
  );
}

const STATUSES = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Called" },
  { key: "booked", label: "Booked" },
  { key: "not_interested", label: "Not interested" },
] as const;

function ReferralRow({ r, timezone }: { r: ReferralListItem; timezone: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(r.status);
  const [pending, startTransition] = useTransition();
  const pick = (s: string) =>
    startTransition(async () => {
      const before = status;
      setStatus(s);
      const res = await setReferralStatus(r.id, s);
      if (!res.ok) setStatus(before);
      router.refresh();
    });
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{r.name}</p>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          <a href={`tel:${r.phone}`} className="hover:text-brand">{formatPhone(r.phone)}</a>
          {r.email && <> · <a href={`mailto:${r.email}`} className="hover:text-brand">{r.email}</a></>}
          {r.address && <> · {r.address}</>}
        </p>
        <p className="mt-0.5 text-[12px] text-fg-faint">
          Referred by{" "}
          <Link href={`/dashboard/clients?id=call:${r.referredById}`} className="text-fg-muted hover:text-brand">
            {r.referredBy}
          </Link>{" "}
          · {DateTime.fromISO(r.createdAt, { zone: timezone }).toFormat("LLL d")}
          {r.crmError && <span className="text-bad"> · CRM: {r.crmError}</span>}
        </p>
      </div>
      <div role="radiogroup" aria-label={`Status for ${r.name}`} className="flex shrink-0 gap-1 rounded-lg bg-white/[0.04] p-1">
        {STATUSES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={status === s.key}
            disabled={pending}
            onClick={() => status !== s.key && pick(s.key)}
            className={cn("h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors", status === s.key ? "bg-brand/15 text-brand" : "text-fg-muted hover:text-fg")}
          >
            {s.label}
          </button>
        ))}
      </div>
    </li>
  );
}

function GiftCardRow({ g, timezone }: { g: GiftCardItem; timezone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      await setGiftCardSent(g.bookingId, !g.sentAt);
      router.refresh();
    });
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">
          {g.name} · ${(g.cents / 100).toFixed(g.cents % 100 ? 2 : 0)}
        </p>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          {g.email ?? "No email"} · {formatPhone(g.phone)} · earned {DateTime.fromISO(g.owedAt, { zone: timezone }).toFormat("LLL d")}
          {g.sentAt && ` · sent ${DateTime.fromISO(g.sentAt, { zone: timezone }).toFormat("LLL d")}`}
        </p>
      </div>
      {g.sentAt ? (
        <Button size="sm" variant="ghost" onClick={toggle} disabled={pending}>
          <Check className="size-4 text-good" /> Sent
        </Button>
      ) : (
        <Button size="sm" onClick={toggle} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />} Mark sent
        </Button>
      )}
    </li>
  );
}

/** The Referrals tab. */
export function ReferralsView({ referrals, giftCards, timezone, ready }: { referrals: ReferralListItem[]; giftCards: GiftCardItem[]; timezone: string; ready: boolean }) {
  if (!ready) return <Panel><EmptyState title="Referrals aren't set up yet">The check-in and referrals migration hasn&apos;t run.</EmptyState></Panel>;
  const owed = giftCards.filter((g) => !g.sentAt);
  const sent = giftCards.filter((g) => g.sentAt);
  return (
    <div className="max-w-3xl space-y-4">
      <Panel>
        <PanelHeader title={`Gift cards owed${owed.length ? ` (${owed.length})` : ""}`} description="Customers who reached the referral goal. Send their gift card to the store they choose, then mark it sent." />
        {owed.length || sent.length ? (
          <ul className="divide-y divide-line">
            {[...owed, ...sent].map((g) => <GiftCardRow key={g.bookingId} g={g} timezone={timezone} />)}
          </ul>
        ) : (
          <EmptyState title="None owed yet" />
        )}
      </Panel>
      <Panel>
        <PanelHeader
          title={`Referred people${referrals.length ? ` (${referrals.length})` : ""}`}
          description="Call these by hand. They didn't ask to be contacted themselves, so they're never called by your AI assistant or texted automatically."
        />
        {referrals.length ? (
          <ul className="divide-y divide-line">
            {referrals.map((r) => <ReferralRow key={r.id} r={r} timezone={timezone} />)}
          </ul>
        ) : (
          <EmptyState title="No referrals yet">After you tap Job done on a finished inspection, happy customers get a link to refer friends.</EmptyState>
        )}
      </Panel>
    </div>
  );
}

/** Settings: check-in calls on/off, the reward, how many referrals earn it, the optional intro email, the CRM webhook. */
export function CheckinSettingsForm({
  initial,
  ready,
  webhook,
}: {
  initial: { on: boolean; rewardCents: number; goal: number; introEmail: boolean; mailingAddress: string; googleReviewUrl: string };
  ready: boolean;
  webhook: { url: string; secret: string } | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ on: initial.on, reward: String(initial.rewardCents / 100), goal: String(initial.goal), introEmail: initial.introEmail, mailingAddress: initial.mailingAddress, googleReviewUrl: initial.googleReviewUrl });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (next = form) =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const res = await saveCheckinSettings({ on: next.on, rewardDollars: Number(next.reward), goal: Number(next.goal), introEmail: next.introEmail, mailingAddress: next.mailingAddress, googleReviewUrl: next.googleReviewUrl });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    });
  const copy = (k: string, v: string) => {
    navigator.clipboard?.writeText(v).then(() => {
      setCopied(k);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Check-in calls and referrals</h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            When you mark a job done, your AI assistant calls the customer about 2 hours later (8am to 8pm) to ask if it went well. Happy customers are emailed a Google review link and a link to refer friends for a gift card; if something went wrong, you&apos;re alerted right away and nothing is pitched. Customers who didn&apos;t agree to AI calls get the email only.
          </p>
          {!ready && <p className="mt-1 text-[13px] text-fg-muted">Calls aren&apos;t available yet: the check-in line is still being set up. Job done still sends the referral email.</p>}
        </div>
        <Switch
          checked={form.on}
          label="Check-in calls"
          disabled={pending || (!ready && !form.on)}
          onChange={(on) => {
            const next = { ...form, on };
            setForm(next);
            save(next);
          }}
        />
      </div>
      <div className="space-y-4 border-t border-line px-5 py-4">
        <div>
          <Label htmlFor="ref-review">Google review link</Label>
          <input id="ref-review" className={inputClass} placeholder="https://g.page/r/…/review" value={form.googleReviewUrl} onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })} />
          <p className="mt-1 text-[12px] text-fg-muted">Added to the thank-you email next to the referral link. In Google Business Profile, choose &quot;Ask for reviews&quot; to copy it.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <Label htmlFor="ref-reward">Gift card ($)</Label>
            <input id="ref-reward" inputMode="decimal" className={`${inputClass} w-28`} value={form.reward} onChange={(e) => setForm({ ...form, reward: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ref-goal">Referrals to earn it</Label>
            <input id="ref-goal" inputMode="numeric" className={`${inputClass} w-28`} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-fg">Email each referred person once</p>
            <p className="text-[13px] text-fg-muted">&quot;{"{Customer}"} thought you might need a roofer&quot;, with your booking link. One plain email, never a call or text. Needs your business mailing address (the law requires it in marketing email).</p>
          </div>
          <Switch checked={form.introEmail} label="Email each referred person once" disabled={pending} onChange={(introEmail) => setForm({ ...form, introEmail })} />
        </div>
        <div>
          <Label htmlFor="ref-mailing">Business mailing address</Label>
          <input id="ref-mailing" className={inputClass} placeholder="123 Main St, Plano, TX 75074" value={form.mailingAddress} onChange={(e) => setForm({ ...form, mailingAddress: e.target.value })} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => save()} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-[13px] text-good">Saved</span>}
          {error && <span className="text-[13px] text-bad">{error}</span>}
        </div>
      </div>
      {webhook && (
        <div className="space-y-2 border-t border-line px-5 py-4">
          <p className="text-sm font-medium text-fg">Mark jobs done from your CRM</p>
          <p className="text-[13px] text-fg-muted">
            In Zapier, when a job&apos;s status changes to complete in JobNimbus, AccuLynx or Leap, add a &quot;Webhooks by Zapier&quot; POST to this URL with the header <code className="text-fg">x-job-secret</code> and the customer&apos;s <code className="text-fg">phone</code> or <code className="text-fg">email</code> in the body. It works like tapping Job done.
          </p>
          {[
            ["url", "URL", webhook.url],
            ["secret", "x-job-secret", webhook.secret],
          ].map(([k, label, v]) => (
            <div key={k} className="flex items-center gap-2 text-[13px]">
              <span className="w-24 shrink-0 text-fg-faint">{label}</span>
              <code className="min-w-0 flex-1 truncate rounded-md bg-white/[0.04] px-2 py-1 text-fg">{v}</code>
              <button type="button" onClick={() => copy(k, v)} aria-label={`Copy ${label}`} className="rounded-md p-1.5 text-fg-muted hover:bg-white/[0.06] hover:text-fg">
                {copied === k ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
