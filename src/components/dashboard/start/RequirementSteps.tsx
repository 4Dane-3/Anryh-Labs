"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";
import { chooseMigzMode, connectSlack, saveBusinessInfo, saveMetaAccess, setBookingChoice } from "@/app/dashboard/actions";
import { RUN_MODES } from "@/components/dashboard/start/CampaignFlow";
import { displayPhone } from "@/lib/booking/call";
import { Button, Label, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// The Start here steps that collect what Anryh Labs needs before anything else: business details, the Meta
// ad account and Page, where ads send people, and Slack.

function useSave(onSaved: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error);
      router.refresh();
      onSaved();
    });
  return { pending, error, run };
}

const Note = ({ children }: { children: React.ReactNode }) => <p className="mt-1.5 text-[12px] text-fg-faint">{children}</p>;

export type Business = { agency_name: string; npn: string; business_email: string; phone: string };

/** Their agency, NPN (optional), the email replies go to and the number leads reach them on. */
export function BusinessStep({ initial, onSaved }: { initial: Business; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const { pending, error, run } = useSave(onSaved);
  const set = (k: keyof Business) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveBusinessInfo(form));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="agency">Agency or IMO</Label>
          <input id="agency" className={inputClass} placeholder="Who you write through" value={form.agency_name} onChange={set("agency_name")} />
        </div>
        <div>
          <Label htmlFor="npn">NPN (optional)</Label>
          <input id="npn" inputMode="numeric" className={inputClass} placeholder="National Producer Number" value={form.npn} onChange={set("npn")} />
        </div>
        <div>
          <Label htmlFor="bemail">Business email</Label>
          <input id="bemail" type="email" className={inputClass} value={form.business_email} onChange={set("business_email")} />
          <Note>When a lead replies to an email we send for you, it goes here.</Note>
        </div>
        <div>
          <Label htmlFor="lphone">Phone for leads</Label>
          <input id="lphone" type="tel" className={inputClass} placeholder="(555) 555-0100" value={form.phone} onChange={set("phone")} />
          <Note>The number leads call, and the &quot;Call now&quot; button on your page if you turn it on.</Note>
        </div>
      </div>
      <p className="rounded-lg bg-white/[0.04] px-4 py-3 text-[12px] leading-relaxed text-fg-muted">
        Your license number and NPN are optional, and only shown where you choose to show them. You&apos;re responsible for your own licensing,
        appointments and compliance: Anryh Labs runs your ads and booking tools, and isn&apos;t an insurance agency or carrier.
      </p>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <Button type="submit" className="bg-brand text-brand-fg hover:bg-brand/90" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </form>
  );
}

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[12px] text-fg transition-colors hover:border-line-strong"
    >
      {value} {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5 text-fg-faint" />}
    </button>
  );
}

/** Instructions for sharing their ad account and Page with our Business Manager, then the IDs and a check. */
export function MetaStep({
  businessId,
  linked,
  requested,
  onSaved,
}: {
  businessId: string;
  linked: { adAccount: string; page: string } | null;
  requested: { adAccount: string; page: string; at: string | null };
  onSaved: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ adAccount: requested.adAccount, page: requested.page });
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ good: boolean; text: string } | null>(null);

  if (linked)
    return (
      <p className="text-[13px] text-fg-muted">
        Linked: ad account <span className="font-mono text-fg">{linked.adAccount}</span> and Page <span className="font-mono text-fg">{linked.page}</span>. Migz runs your ads
        from here.
      </p>
    );

  const save = () =>
    start(async () => {
      setResult(null);
      const res = await saveMetaAccess(form);
      if (!res.ok) return setResult({ good: false, text: res.error });
      setResult({ good: res.linked, text: res.message });
      router.refresh();
      if (res.linked) onSaved();
    });

  return (
    <div className="space-y-5">
      <ol className="space-y-3 text-[13px] text-fg-muted">
        <li>
          <span className="text-fg">1. Have a Meta ad account and a Facebook Page for your business.</span> No ad account yet? Create one in{" "}
          <a className="text-fg underline-offset-4 hover:underline" href="https://business.facebook.com/settings/ad-accounts" target="_blank" rel="noreferrer">
            Business Settings → Ad accounts
          </a>
          .
        </li>
        <li>
          <span className="text-fg">2. Share both with Anryh Labs.</span> In{" "}
          <a className="text-fg underline-offset-4 hover:underline" href="https://business.facebook.com/settings/partners" target="_blank" rel="noreferrer">
            Business Settings → Partners
          </a>
          , choose Add → Give a partner access to your assets, and enter our Business ID: <CopyId value={businessId} /> (it shows as Clync). Give full control of your ad
          account and your Page.
        </li>
        <li>
          <span className="text-fg">3. Tell us which ones you shared</span> below. We&apos;ll accept the request, usually within a business day.
        </li>
      </ol>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="adacct">Ad account ID</Label>
          <input id="adacct" className={`${inputClass} font-mono`} placeholder="1234567890" value={form.adAccount} onChange={(e) => setForm({ ...form, adAccount: e.target.value })} />
          <Note>In Ads Manager, it&apos;s the number next to your account&apos;s name.</Note>
        </div>
        <div>
          <Label htmlFor="fbpage">Facebook Page</Label>
          <input id="fbpage" className={inputClass} placeholder="facebook.com/yourpage" value={form.page} onChange={(e) => setForm({ ...form, page: e.target.value })} />
          <Note>Its link, or the Page ID from the Page&apos;s About section.</Note>
        </div>
      </div>
      {result && <p className={cn("text-[13px]", result.good ? "text-good" : "text-brand")}>{result.text}</p>}
      <Button className="bg-brand text-brand-fg hover:bg-brand/90" disabled={pending} onClick={save}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {requested.at ? "Check again" : "I've shared them"}
      </Button>
    </div>
  );
}

/** Where ads send people: their page here (recommended, tracked), or their own booking page. */
export function BookingStep({
  choice,
  ownUrl,
  slug,
  pageUrl,
  hoursMissing,
  onSaved,
}: {
  choice: "ours" | "own" | null;
  ownUrl: string;
  slug: string;
  pageUrl: string;
  hoursMissing: boolean;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState(choice);
  const [url, setUrl] = useState(ownUrl);
  const { pending, error, run } = useSave(() => {});

  const pickOurs = () => {
    setPicked("ours");
    run(() => setBookingChoice({ choice: "ours", url: "" }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={picked === "ours"}
          disabled={pending}
          onClick={pickOurs}
          className={cn("rounded-lg border px-4 py-3 text-left transition-colors", picked === "ours" ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]")}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-fg">
            Use my booking page here <span className="rounded-full bg-good/15 px-2 py-0.5 text-[11px] text-good">Recommended</span>
          </span>
          <span className="mt-1 block text-[12px] leading-snug text-fg-muted">
            A page made for you, ready now. Every booking is tracked: Meta learns from it and Migz sees which ads book calls.
          </span>
        </button>
        <button
          type="button"
          aria-pressed={picked === "own"}
          disabled={pending}
          onClick={() => setPicked("own")}
          className={cn("rounded-lg border px-4 py-3 text-left transition-colors", picked === "own" ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]")}
        >
          <span className="block text-sm font-medium text-fg">I have my own booking page</span>
          <span className="mt-1 block text-[12px] leading-snug text-fg-muted">Calendly, your website, anything else. Your ads link straight to it.</span>
        </button>
      </div>

      {picked === "own" && (
        <form
          className="space-y-3 rounded-lg bg-white/[0.04] px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await setBookingChoice({ choice: "own", url });
              if (res.ok) onSaved();
              return res;
            });
          }}
        >
          <p className="text-[12px] leading-relaxed text-brand">
            On your own page we can&apos;t see bookings. Meta won&apos;t learn which ads book calls, Migz can&apos;t count them, and booking follow-ups won&apos;t run. Your page
            here keeps all of that, which is why we recommend it.
          </p>
          <div>
            <Label htmlFor="ownurl">Your booking page</Label>
            <input id="ownurl" type="url" className={inputClass} placeholder="https://calendly.com/you/call" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Use this page
          </Button>
        </form>
      )}

      {picked === "ours" && (
        <div className="space-y-3">
          {hoursMissing && <p className="text-[13px] text-brand">Set the hours you take calls.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            <Link href="/dashboard/calendar" className="rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-white/[0.03]">
              <span className="block text-sm font-medium text-fg">Set your hours</span>
              <span className="mt-1 block text-[12px] text-fg-muted">When people can book a call with you.</span>
            </Link>
            <Link href="/dashboard/questions" className="rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-white/[0.03]">
              <span className="block text-sm font-medium text-fg">Your questions</span>
              <span className="mt-1 block text-[12px] text-fg-muted">What you ask people. Make any of them required before booking.</span>
            </Link>
            <a href={pageUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-white/[0.03]">
              <span className="flex items-center gap-1 text-sm font-medium text-fg">
                View your page <ArrowUpRight className="size-3.5" />
              </span>
              <span className="mt-1 block truncate text-[12px] text-fg-muted">/{slug}</span>
            </a>
          </div>
          <p className="text-[12px] text-fg-faint">Your title, headline and testimonials are on the My page tab when you want to polish them.</p>
        </div>
      )}
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

/** Joining the Anryh Labs Slack and sending Migz their member ID; it's saved once a test message reaches them. */
export function SlackStep({ inviteUrl, contactEmail, current, onSaved }: { inviteUrl: string | null; contactEmail: string; current: string; onSaved: () => void }) {
  const [id, setId] = useState(current);
  const { pending, error, run } = useSave(onSaved);
  return (
    <div className="space-y-4">
      <ol className="space-y-2.5 text-[13px] text-fg-muted">
        <li>
          <span className="text-fg">1. Join the Anryh Labs Slack.</span>{" "}
          {inviteUrl ? (
            <a className="text-fg underline-offset-4 hover:underline" href={inviteUrl} target="_blank" rel="noreferrer">
              Open your invite
            </a>
          ) : (
            <>
              Check your email for our invite, or{" "}
              <a className="text-fg underline-offset-4 hover:underline" href={`mailto:${contactEmail}?subject=${encodeURIComponent("Slack invite")}`}>
                ask for one
              </a>
            </>
          )}
          , and get the Slack app on your phone so new leads reach you right away.
        </li>
        <li>
          <span className="text-fg">2. Copy your member ID.</span> In Slack, tap your profile picture → Profile → ⋮ (More) → Copy member ID.
        </li>
        <li>
          <span className="text-fg">3. Paste it here.</span> Migz sends you a test message to make sure it reaches you.
        </li>
      </ol>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => connectSlack(id));
        }}
      >
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="slackid">Slack member ID</Label>
          <input id="slackid" className={`${inputClass} font-mono`} placeholder="U04ABCD1234" value={id} onChange={(e) => setId(e.target.value)} />
        </div>
        <Button type="submit" className="bg-brand text-brand-fg hover:bg-brand/90" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Send test message
        </Button>
      </form>
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

/** The last step: Migz runs the ads on its own, or asks before every new ad and change. */
export function MigzModeStep({ current, onSaved }: { current: "auto" | "approve" | null; onSaved: () => void }) {
  const [picked, setPicked] = useState(current);
  const { pending, error, run } = useSave(onSaved);
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="How Migz runs your ads" className="grid gap-2 sm:grid-cols-2">
        {RUN_MODES.map((m) => {
          const mode = m.auto ? "auto" : "approve";
          const on = picked === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              onClick={() => {
                setPicked(mode);
                run(() => chooseMigzMode(mode));
              }}
              className={cn("rounded-lg border px-4 py-3 text-left transition-colors", on ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]")}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                {m.title}
                {m.recommended && <span className="rounded-full bg-good/15 px-2 py-0.5 text-[11px] text-good">Recommended</span>}
              </span>
              <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{m.detail}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-fg-faint">You can switch any time in Settings. Either way, Migz never spends past your daily budget or your balance.</p>
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

export const phoneForInput = (e164: string | null | undefined) => (e164 ? displayPhone(e164) : "");
