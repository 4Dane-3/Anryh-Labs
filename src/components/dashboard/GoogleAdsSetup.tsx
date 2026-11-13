"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { checkGoogleAds, connectGoogleAds, createGoogleAdsAccount, saveGoogleSettings } from "@/app/dashboard/google/actions";
import { Button, Label, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

export type GoogleSetupInitial = {
  account: { customerId: string; status: "pending" | "linked" | "created" | "refused" | "ended"; monthlyCapCents: number; enabled: boolean; inviteEmail: string | null; built: boolean; lastError: string | null } | null;
  avgJobDollars: number | null;
  minMonthly: number;
  recommendedMonthly: number;
};

const fmtId = (id: string) => (/^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

/** Connect Google Ads: link their account to Anryh Labs (or have us make one), set the monthly cap, and the switch. */
export function GoogleAdsSetup({ initial, onSaved }: { initial: GoogleSetupInitial; onSaved?: () => void }) {
  const router = useRouter();
  const acct = initial.account;
  const live = acct && (acct.status === "linked" || acct.status === "created");
  const [mode, setMode] = useState<"have" | "new">(acct?.status === "created" ? "new" : "have");
  const [customerId, setCustomerId] = useState(acct ? fmtId(acct.customerId) : "");
  const [email, setEmail] = useState(acct?.inviteEmail ?? "");
  const [monthly, setMonthly] = useState(String((acct?.monthlyCapCents ?? initial.recommendedMonthly * 100) / 100));
  const [enabled, setEnabled] = useState(acct?.enabled ?? true);
  const [avgJob, setAvgJob] = useState(initial.avgJobDollars ? String(initial.avgJobDollars) : "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ good: boolean; text: string } | null>(null);

  const run = (fn: () => ReturnType<typeof checkGoogleAds>, done?: (status?: string) => boolean) =>
    start(async () => {
      setResult(null);
      const r = await fn();
      if (!r.ok) return setResult({ good: false, text: r.error });
      setResult({ good: true, text: r.message });
      router.refresh();
      if (done?.(r.status)) onSaved?.();
    });

  const dollars = Number(monthly.replace(/[$,\s]/g, ""));
  const budgetField = (
    <div>
      <Label htmlFor="g-monthly">Monthly Google budget (you pay Google directly)</Label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-fg-muted">$</span>
        <input id="g-monthly" inputMode="numeric" className={cn(inputClass, "max-w-[160px]")} value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        <span className="text-[13px] text-fg-muted">a month</span>
      </div>
      <p className="mt-1 text-[12px] text-fg-muted">
        At least ${initial.minMonthly.toLocaleString("en-US")}; we recommend ${initial.recommendedMonthly.toLocaleString("en-US")}+. Roofing clicks on Google often cost $15 to $50, so smaller budgets get too few clicks to book jobs. This is on top of your Meta ad budget, and Migz never budgets past it.
      </p>
    </div>
  );

  if (live)
    return (
      <div className="space-y-4">
        <p className="text-[13px] text-fg-muted">
          Account <span className="font-mono text-fg">{fmtId(acct.customerId)}</span> is linked.{" "}
          {acct.built ? "Migz runs your Google Search campaign and reviews it every day." : "Migz builds your Google Search campaign once your campaign starts."}
          {acct.status === "created" && " Make sure you accepted Google's invitation and added your card under Billing in Google Ads."}
        </p>
        {acct.lastError && <p className="text-[13px] text-brand">Last run: {acct.lastError}</p>}
        {budgetField}
        <div>
          <Label htmlFor="g-avg">Your average job (optional)</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-fg-muted">$</span>
            <input id="g-avg" inputMode="numeric" placeholder="12000" className={cn(inputClass, "max-w-[160px]")} value={avgJob} onChange={(e) => setAvgJob(e.target.value)} />
          </div>
          <p className="mt-1 text-[12px] text-fg-muted">Sent to Google with each closed job, so it learns which searches bring the bigger jobs.</p>
        </div>
        <label className="flex items-center gap-3 text-[13px] text-fg">
          <Switch checked={enabled} onChange={setEnabled} label="Google ads on" />
          Google ads on
        </label>
        {result && <p className={cn("text-[13px]", result.good ? "text-good" : "text-brand")}>{result.text}</p>}
        <Button variant="primary" disabled={pending} onClick={() => run(() => saveGoogleSettings({ monthlyDollars: dollars, enabled, avgJobDollars: avgJob ? Number(avgJob.replace(/[$,\s]/g, "")) : null }), () => true)}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    );

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-fg-muted">
        Google Search reaches homeowners at the moment they search &ldquo;roof replacement near me&rdquo;. Migz builds the campaign, blocks wasted searches every day, writes and tests the ads, and sends your booked inspections and closed jobs back to Google so it finds more people who buy. The account stays yours.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["have", "new"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("rounded-lg border px-4 py-3 text-left text-[13px] transition-colors", mode === m ? "border-brand/60 bg-brand/[0.08] text-fg" : "border-line text-fg-muted hover:border-line-strong")}>
            <span className="block font-semibold text-fg">{m === "have" ? "I have a Google Ads account" : "I don't have one"}</span>
            {m === "have" ? "We send a request to manage it; you accept it in Google Ads." : "We make one for you, with you as its admin."}
          </button>
        ))}
      </div>
      {mode === "have" ? (
        <div>
          <Label htmlFor="g-cid">Google Ads customer ID</Label>
          <input id="g-cid" className={cn(inputClass, "max-w-[220px] font-mono")} placeholder="123-456-7890" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
          <p className="mt-1 text-[12px] text-fg-muted">Top right in Google Ads, next to your account name.</p>
        </div>
      ) : (
        <div>
          <Label htmlFor="g-email">Google email that should own it</Label>
          <input id="g-email" type="email" className={cn(inputClass, "max-w-[320px]")} placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="mt-1 text-[12px] text-fg-muted">Google emails it an invitation to be the account&apos;s admin. You add your own card under Billing.</p>
        </div>
      )}
      {budgetField}
      {acct?.status === "pending" && (
        <p className="text-[13px] text-fg-muted">
          Request sent to <span className="font-mono text-fg">{fmtId(acct.customerId)}</span>. In Google Ads open Admin → Access and security → Managers and accept Anryh Labs.
        </p>
      )}
      {acct?.status === "refused" && <p className="text-[13px] text-brand">The request was declined. Save the ID again to send a new one.</p>}
      {result && <p className={cn("text-[13px]", result.good ? "text-good" : "text-brand")}>{result.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            mode === "have"
              ? run(() => connectGoogleAds({ customerId, monthlyDollars: dollars }), (s) => s === "linked")
              : run(() => createGoogleAdsAccount({ email, monthlyDollars: dollars }), (s) => s === "created")
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          {mode === "have" ? (acct?.status === "pending" ? "Send again" : "Connect") : "Make my account"}
        </Button>
        {acct?.status === "pending" && (
          <Button disabled={pending} onClick={() => run(checkGoogleAds, (s) => s === "linked")}>
            Check again
          </Button>
        )}
      </div>
    </div>
  );
}
