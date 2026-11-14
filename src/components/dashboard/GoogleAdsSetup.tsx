"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { checkAdDomain, checkGoogleAds, connectGoogleAds, createGoogleAdsAccount, saveAdDomain, saveGoogleSettings } from "@/app/dashboard/google/actions";
import { Button, Label, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

export type GoogleSetupInitial = {
  account: { customerId: string; status: "pending" | "linked" | "created" | "refused" | "ended"; monthlyCapCents: number; enabled: boolean; inviteEmail: string | null; built: boolean; lastError: string | null } | null;
  adDomain: { domain: string; live: boolean } | null;
  website: string | null;
  pages: { name: string; title: string; url: string; preview: string }[];
  avgJobDollars: number | null;
  minMonthly: number;
  recommendedMonthly: number;
};

/** Where their ads send people: an address on their own domain, served by us. They add one DNS record. */
function AdAddress({ initial, website: savedSite, pages }: { initial: { domain: string; live: boolean } | null; website: string | null; pages: GoogleSetupInitial["pages"] }) {
  const router = useRouter();
  const [website, setWebsite] = useState(savedSite ?? "");
  const root = website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
  const [domain, setDomain] = useState(initial?.domain ?? (root ? `book.${root}` : ""));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ good: boolean; text: string } | null>(null);
  const saved = initial?.domain === domain.trim().toLowerCase().replace(/^https?:\/\//, "");
  const run = (fn: () => ReturnType<typeof checkAdDomain>) =>
    start(async () => {
      setResult(null);
      const r = await fn();
      setResult(r.ok ? { good: true, text: r.message } : { good: false, text: r.error });
      router.refresh();
    });
  const host = (initial?.domain ?? "book.yourroofing.com").split(".")[0];
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="g-site">Your website</Label>
        <input
          id="g-site"
          className={cn(inputClass, "max-w-[320px]")}
          placeholder="yourroofing.com"
          value={website}
          onChange={(e) => {
            const next = e.target.value;
            const r = next.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
            if (!initial && (!domain || domain === `book.${root}`)) setDomain(r ? `book.${r}` : "");
            setWebsite(next);
          }}
        />
        <p className="mt-1 text-[12px] text-fg-muted">Your landing pages are built in your website&apos;s fonts and colours, and live on its domain.</p>
      </div>
    <div>
      <Label htmlFor="g-domain">Your ad address (on your own website&apos;s domain)</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input id="g-domain" className={cn(inputClass, "max-w-[320px]")} placeholder="book.yourroofing.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <Button disabled={pending || !domain.trim() || !website.trim()} onClick={() => run(() => saveAdDomain({ domain, website }))}>
          {pending && <Loader2 className="animate-spin" />}
          {initial ? "Save" : "Set up"}
        </Button>
        {initial && saved && !initial.live && (
          <Button disabled={pending} onClick={() => run(checkAdDomain)}>
            Check again
          </Button>
        )}
      </div>
      <p className="mt-1 text-[12px] text-fg-muted">
        Your ads always show your own domain, never ours. Your main website isn&apos;t touched: this one address shows your booking page.
      </p>
      {initial && !initial.live && (
        <div className="mt-2 rounded-lg border border-line px-4 py-3 text-[12px] text-fg-muted">
          Add this record where your domain&apos;s DNS is managed (GoDaddy, Squarespace, Cloudflare and so on):
          <div className="mt-2 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 font-mono text-fg">
            <span className="text-fg-muted">Type</span><span>CNAME</span>
            <span className="text-fg-muted">Name</span><span>{host}</span>
            <span className="text-fg-muted">Value</span><span>cname.vercel-dns.com</span>
          </div>
          <p className="mt-2">It can take up to an hour. Then press Check again.</p>
        </div>
      )}
      {initial?.live && <p className="mt-2 text-[12px] text-good">Live: your ads use {initial.domain}.</p>}
      {result && <p className={cn("mt-2 text-[13px]", result.good ? "text-good" : "text-brand")}>{result.text}</p>}
    </div>
      {pages.length > 0 && (
        <div>
          <Label>Your landing pages, one for each ad group</Label>
          <ul className="mt-1 space-y-1.5 text-[13px]">
            {pages.map((p) => (
              <li key={p.name} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-fg">{p.title}</span>
                <span className="text-fg-muted">·</span>
                <a href={p.preview} target="_blank" rel="noreferrer" className="text-fg-muted underline underline-offset-2 hover:text-fg">
                  {initial?.live ? p.url.replace(/^https:\/\//, "") : "preview"}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-fg-muted">Each Google ad goes to the page for its job, with the same headline as the ad.</p>
        </div>
      )}
    </div>
  );
}

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
        <AdAddress initial={initial.adDomain} website={initial.website} pages={initial.pages} />
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
      <AdAddress initial={initial.adDomain} website={initial.website} pages={initial.pages} />
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
