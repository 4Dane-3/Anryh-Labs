"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { launchCampaign, saveBatchPlan, setCreativeMode, startSetupFee } from "@/app/dashboard/actions";
import { SETUP_FEE_CENTS } from "@/lib/campaign";
import { CampaignFlow, type CampaignStart } from "@/components/dashboard/start/CampaignFlow";
import { listCampaignTopics, type CampaignSlot } from "@/lib/batch";
import { AddFunds } from "@/components/dashboard/FundsControls";
import { AutoTopUp, type AutoTopUpState } from "@/components/dashboard/AutoTopUp";
import { ProfileForm, type Profile } from "@/components/dashboard/LandingEditor";
import { Button, Panel } from "@/components/dashboard/ui";
import { FUNDS_STEP_CENTS, KEEP_FUNDED, type OwnNumbers } from "@/lib/campaign-plan";
import { TARGET_HIGH, TARGET_LOW } from "@/lib/guarantee";
import { usd } from "@/lib/dashboard/format";
import { cleanFocus, TOPICS } from "@/lib/migz/topics";
import { cn } from "@/lib/utils";
import { JobRulesForm } from "@/components/dashboard/JobRules";
import type { JobRules } from "@/lib/roofing/job-rules";
import { BookingStep, BusinessStep, MetaStep, MigzModeStep, SlackStep, type Business } from "@/components/dashboard/start/RequirementSteps";

type StepState = { key: string; done: boolean; missing: string | null };

type Props = {
  steps: StepState[];
  profile: Profile;
  slug: string;
  balanceCents: number;
  fundsAddedCents: number; // everything added so far: sets the fee (20%, then 12% after $20,000)
  setupFeePaidAt: string | null;
  stripeConnected: boolean;
  connected: boolean; // Meta ad account linked and Migz configured
  plan: {
    topics: string[];
    batch: { budget_cents: number; option: string; campaigns: string[]; days: number; daily_cents: number } | null;
    start: CampaignStart;
    own: OwnNumbers | null;
    fundsNeeded: { cents: number; recommendedCents: number } | null;
  };
  creativeMode: "upload" | "ai" | "both" | null;
  creativeCount: number;
  contactEmail: string;
  completed: boolean;
  business: Business;
  meta: {
    businessId: string;
    linked: { adAccount: string; page: string } | null;
    requested: { adAccount: string; page: string; at: string | null };
  };
  booking: { choice: "ours" | "own" | null; ownUrl: string; pageUrl: string; hoursMissing: boolean };
  slack: { current: string; inviteUrl: string | null };
  migzMode: "auto" | "approve" | null; // null until chosen here
  autoTopUp: AutoTopUpState | null; // null without Stripe
  jobRules?: JobRules | null; // a roofer's "Jobs we take" (null = none saved)
};

const TITLES: Record<string, { title: string; blurb: string }> = {
  business: { title: "Your business", blurb: "Your agency or IMO, your business email and the number leads reach you on." },
  meta: { title: "Your Meta ad account", blurb: "Share your ad account and Facebook Page with Anryh Labs, so Migz can run your ads." },
  setup_fee: { title: `Setup fee: ${usd(SETUP_FEE_CENTS, { cents: false })}`, blurb: "One time, before anything else. It covers setting up your ad account, your first campaign and your pages." },
  profile: { title: "Your profile", blurb: "Your name, photo and a short bio. People see this before they book." },
  page: { title: "Your booking page", blurb: "Where your ads send people: your page here, or your own." },
  slack: { title: "Slack", blurb: "Where Migz tells you about new leads and bookings, and sends your morning summary." },
  plan: { title: "Plan your first campaign", blurb: "A few quick questions and a daily budget. Migz sets how long it runs and makes the ads." },
  funds: { title: "Add funds", blurb: `Money for your Meta ads, in ${usd(FUNDS_STEP_CENTS)} steps. Campaigns roll week to week while your balance covers them.` },
  creatives: { title: "Videos and images", blurb: "Let Migz make your ads' videos and photos, or bring your own." },
  rules: { title: "Jobs you take", blurb: "Which jobs you want, so your assistant and booking page only book the right ones." },
  mode: { title: "How Migz runs your ads", blurb: "On its own within your budget, or asking you before every new ad and change." },
};

/** What changes for a roofing company. */
const ROOF_TITLES: Record<string, { title: string; blurb: string }> = {
  business: { title: "Your business", blurb: "Your business email and the number homeowners reach you on." },
  profile: { title: "Your company", blurb: "Your company name, logo or photo and a short intro. Homeowners see this before they book." },
  page: { title: "Your booking page", blurb: "Where homeowners book a free inspection, and the hours your crews inspect." },
  slack: { title: "Slack (optional)", blurb: "New inspections also come to your email. Connect Slack if you'd like them there too." },
  plan: { title: "Plan your first campaign", blurb: "What your ads lead with, where you work and a daily budget. Migz makes the ads." },
  rules: { title: "Jobs you take (optional)", blurb: "Replacements, repairs, roof types, claims, homeowners only. Your assistant and booking page follow it; skip it and every lead gets through." },
};

function StepShell({
  roof,
  index,
  stepKey,
  done,
  summary,
  open,
  onToggle,
  children,
}: {
  roof?: boolean;
  index: number;
  stepKey: string;
  done: boolean;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Panel className={cn("overflow-hidden transition-colors", open && "border-line-strong")}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-4 px-5 py-4 text-left" aria-expanded={open}>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors",
            done ? "bg-good/20 text-good" : open ? "bg-brand text-brand-fg" : "border border-line-strong text-fg-muted",
          )}
        >
          {done ? <Check className="size-4" /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">{((roof && ROOF_TITLES[stepKey]) || TITLES[stepKey]).title}</span>
          <span className="block truncate text-[13px] text-fg-muted">{done ? summary : ((roof && ROOF_TITLES[stepKey]) || TITLES[stepKey]).blurb}</span>
        </span>
        <span className={cn("shrink-0 text-[12px]", done ? "text-good" : "text-fg-faint")}>{done ? "Done" : open ? "" : "To do"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-5 py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

/** Step 3: the one-time setup fee, paid on Stripe's page. The step turns done when Stripe confirms it. */
function SetupFeeStep({ stripeConnected, contactEmail }: { stripeConnected: boolean; contactEmail: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pay = () =>
    start(async () => {
      setError(null);
      const res = await startSetupFee();
      if (res.ok) window.location.href = res.url;
      else setError(res.error);
    });
  return (
    <div className="space-y-4">
      <ul className="space-y-1.5 text-[13px] text-fg-muted">
        <li>· Your Meta ad account, page and lead form connected and checked</li>
        <li>· Your first campaign planned and built, with its ads made for you</li>
        <li>· Your booking page and calendar ready for calls</li>
      </ul>
      <p className="text-[13px] text-fg-muted">
        Paid once. After this, the only cost is the fee on the ad funds you add (20%, then 12% once you&apos;ve added $20,000 in all).
      </p>
      {stripeConnected ? (
        <Button className="bg-[#ff7a1a] text-white hover:bg-[#ff7a1a]/90" disabled={pending} onClick={pay}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Pay {usd(SETUP_FEE_CENTS, { cents: false })} setup fee
        </Button>
      ) : (
        <p className="text-[13px] text-fg-muted">
          Card payments aren&apos;t switched on yet. Email{" "}
          <a className="text-fg underline-offset-4 hover:underline" href={`mailto:${contactEmail}?subject=${encodeURIComponent("My setup fee")}`}>
            {contactEmail}
          </a>{" "}
          and we&apos;ll take it another way.
        </p>
      )}
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

function PlanStep({ plan, balanceCents, onSaved }: { plan: Props["plan"]; balanceCents: number; onSaved: () => void }) {
  const router = useRouter();
  return (
    <CampaignFlow
      initial={plan.start}
      balanceCents={balanceCents}
      own={plan.own}
      confirmLabel="Save plan"
      needsBalance={false}
      askRunMode={false}
      onConfirm={async (choice) => {
        const res = await saveBatchPlan(choice);
        if (res.ok) {
          router.refresh();
          onSaved();
        }
        return res;
      }}
    />
  );
}

const CREATIVE_OPTIONS = [
  { value: "ai", title: "Migz creates them", detail: "Migz makes videos and photos for your ads from your topics. Nothing to upload. You can still approve each one." },
  { value: "upload", title: "I'll upload my own", detail: "Your own footage and photos. Real video of you often does best." },
  { value: "both", title: "Both", detail: "Start with your own, and let Migz make more to test new ideas." },
] as const;

function CreativesStep({ mode, count, onSaved }: { mode: Props["creativeMode"]; count: number; onSaved: () => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState(mode);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const choose = (m: "upload" | "ai" | "both") =>
    start(async () => {
      setPicked(m);
      setError(null);
      const res = await setCreativeMode(m);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onSaved();
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {CREATIVE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={picked === o.value}
            disabled={pending}
            onClick={() => choose(o.value)}
            className={cn(
              "rounded-lg border px-4 py-3 text-left transition-colors",
              picked === o.value ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
            )}
          >
            <span className="block text-sm font-medium text-fg">{o.title}</span>
            <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{o.detail}</span>
          </button>
        ))}
      </div>
      {(picked === "upload" || picked === "both") && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/[0.04] px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] text-fg-muted">
            {count > 0 ? `${count} upload${count === 1 ? "" : "s"} ready.` : "No uploads yet."} Add photos or videos on the Creatives page.
          </p>
          <Link href="/dashboard/creatives" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            Open Creatives <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      )}
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

export function StartWizard(props: Props) {
  const router = useRouter();
  const roof = props.plan.start.vertical === "roofing";
  // "Jobs you take" is optional for roofers: it never counts toward launching
  const counted = props.steps.filter((s) => s.key !== "rules");
  const doneCount = counted.filter((s) => s.done).length;
  const firstTodo = props.steps.find((s) => !s.done && s.key !== "rules")?.key ?? null;
  const [open, setOpen] = useState<string | null>(firstTodo);
  const [launching, startLaunch] = useTransition();
  const [launchError, setLaunchError] = useState<string | null>(null);

  const stateOf = (k: string) => props.steps.find((s) => s.key === k)!;
  const ready = doneCount === counted.length;
  const advance = (from: string) => {
    // After finishing a step, open the next unfinished one
    const order = props.steps.map((s) => s.key);
    const next = order.slice(order.indexOf(from) + 1).find((k) => !stateOf(k).done);
    if (next) setOpen(next);
  };

  const launch = () =>
    startLaunch(async () => {
      setLaunchError(null);
      const res = await launchCampaign();
      if (!res.ok) return setLaunchError(res.error);
      router.push("/dashboard/brain?started=1");
    });

  const summaries: Record<string, string> = {
    business: roof ? props.business.business_email || "Saved" : props.business.agency_name,
    meta: props.meta.linked ? `Ad account ${props.meta.linked.adAccount}` : "",
    slack: "Connected",
    setup_fee: props.setupFeePaidAt ? `Paid ${new Date(props.setupFeePaidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "",
    profile: props.profile.full_name,
    page: props.booking.choice === "own" ? `Your own page: ${props.booking.ownUrl.replace(/^https?:\/\//, "")}` : `Live at /${props.slug}`,
    funds: `${usd(props.balanceCents, { cents: true })} available`,
    plan: props.plan.batch
      ? `${usd(props.plan.batch.daily_cents, { cents: false })}/day, rolling · ${listCampaignTopics(props.plan.batch.campaigns.map((t) => (t || null) as CampaignSlot))}`
      : cleanFocus(props.plan.topics).map((t) => TOPICS[t].label).join(", "),
    mode: props.migzMode === "auto" ? "Migz runs it" : "Ask me first",
    creatives: props.creativeMode === "ai" ? "Migz creates them" : props.creativeMode === "upload" ? `${props.creativeCount} of your own` : "Yours plus Migz's",
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="mb-6">
        <div className="mb-2 flex items-baseline justify-between text-[13px]">
          <span className="text-fg-muted">{props.completed ? "Your campaign is set up." : `${doneCount} of ${counted.length} steps done`}</span>
          {!props.completed && <span className="text-fg-faint">About 15 minutes</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${(doneCount / counted.length) * 100}%` }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
        </div>
      </div>

      <StepShell roof={roof} index={1} stepKey="business" done={stateOf("business").done} summary={summaries.business} open={open === "business"} onToggle={() => setOpen(open === "business" ? null : "business")}>
        <BusinessStep initial={props.business} roof={roof} onSaved={() => advance("business")} />
      </StepShell>

      <StepShell roof={roof} index={2} stepKey="meta" done={stateOf("meta").done} summary={summaries.meta} open={open === "meta"} onToggle={() => setOpen(open === "meta" ? null : "meta")}>
        <MetaStep {...props.meta} onSaved={() => advance("meta")} />
      </StepShell>

      <StepShell roof={roof} index={3} stepKey="setup_fee" done={stateOf("setup_fee").done} summary={summaries.setup_fee} open={open === "setup_fee"} onToggle={() => setOpen(open === "setup_fee" ? null : "setup_fee")}>
        <SetupFeeStep stripeConnected={props.stripeConnected} contactEmail={props.contactEmail} />
      </StepShell>

      <StepShell roof={roof} index={4} stepKey="profile" done={stateOf("profile").done} summary={summaries.profile} open={open === "profile"} onToggle={() => setOpen(open === "profile" ? null : "profile")}>
        <ProfileForm profile={props.profile} onSaved={() => advance("profile")} />
      </StepShell>

      <StepShell roof={roof} index={5} stepKey="page" done={stateOf("page").done} summary={summaries.page} open={open === "page"} onToggle={() => setOpen(open === "page" ? null : "page")}>
        <BookingStep {...props.booking} slug={props.slug} onSaved={() => advance("page")} />
      </StepShell>

      <StepShell roof={roof} index={6} stepKey="slack" done={stateOf("slack").done} summary={summaries.slack} open={open === "slack"} onToggle={() => setOpen(open === "slack" ? null : "slack")}>
        <SlackStep current={props.slack.current} inviteUrl={props.slack.inviteUrl} contactEmail={props.contactEmail} onSaved={() => advance("slack")} />
      </StepShell>

      <StepShell roof={roof} index={7} stepKey="plan" done={stateOf("plan").done} summary={summaries.plan} open={open === "plan"} onToggle={() => setOpen(open === "plan" ? null : "plan")}>
        <PlanStep plan={props.plan} balanceCents={props.balanceCents} onSaved={() => advance("plan")} />
      </StepShell>

      {roof && (
        <StepShell roof index={8} stepKey="rules" done={stateOf("rules").done} summary="Saved" open={open === "rules"} onToggle={() => setOpen(open === "rules" ? null : "rules")}>
          <JobRulesForm initial={props.jobRules ?? null} onSaved={() => advance("rules")} />
        </StepShell>
      )}

      <StepShell roof={roof} index={roof ? 9 : 8} stepKey="funds" done={stateOf("funds").done} summary={summaries.funds} open={open === "funds"} onToggle={() => setOpen(open === "funds" ? null : "funds")}>
        <div className="-mx-5 -my-5">
          <div className="border-b border-line px-5 py-4">
            <p className="text-[13px] text-fg-muted">Available balance</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{usd(props.balanceCents, { cents: true })}</p>
            {props.plan.fundsNeeded && (
              <p className="mt-1 text-[13px] text-fg-muted">
                Your first week needs {usd(props.plan.fundsNeeded.cents, { cents: false })} of ad funds. We recommend {usd(props.plan.fundsNeeded.recommendedCents, { cents: false })} (the next {usd(FUNDS_STEP_CENTS, { cents: false })} step): treat it as the minimum.
              </p>
            )}
            <p className="mt-2 text-[13px] text-fg-muted">{KEEP_FUNDED}</p>
            <p className="mt-2 text-[13px] text-fg-muted">
              <span className="text-fg">Booked-call guarantee:</span> keep your campaign funded and running for its first 30 days, on your Anryh Labs booking page with your calendar
              open, and get {TARGET_LOW} booked calls ({TARGET_HIGH} at $75/day or more), or we credit back your Anryh Labs fee.
            </p>
          </div>
          <AddFunds addedBeforeCents={props.fundsAddedCents} />
          {props.autoTopUp && (
            <div className="border-t border-line [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section]:shadow-none">
              <AutoTopUp state={props.autoTopUp} />
            </div>
          )}
          {!props.stripeConnected && (
            <p className="border-t border-line px-6 py-4 text-[13px] text-fg-muted">
              Card payments aren&apos;t switched on yet. To add funds now, email{" "}
              <a className="text-fg underline-offset-4 hover:underline" href={`mailto:${props.contactEmail}?subject=${encodeURIComponent("Add funds to my ad balance")}`}>
                {props.contactEmail}
              </a>{" "}
              and we&apos;ll add them for you.
            </p>
          )}
        </div>
      </StepShell>

      <StepShell roof={roof} index={roof ? 10 : 9} stepKey="creatives" done={stateOf("creatives").done} summary={summaries.creatives} open={open === "creatives"} onToggle={() => setOpen(open === "creatives" ? null : "creatives")}>
        <CreativesStep mode={props.creativeMode} count={props.creativeCount} onSaved={() => advance("creatives")} />
      </StepShell>

      <StepShell roof={roof} index={roof ? 11 : 10} stepKey="mode" done={stateOf("mode").done} summary={summaries.mode} open={open === "mode"} onToggle={() => setOpen(open === "mode" ? null : "mode")}>
        <MigzModeStep current={props.migzMode} onSaved={() => advance("mode")} />
      </StepShell>

      <Panel className={cn("mt-6 px-5 py-5", ready && !props.completed && "border-brand/40")}>
        <h2 className="text-sm font-semibold text-fg">{props.completed ? "Your campaign" : "Start your campaign"}</h2>
        {props.completed ? (
          <p className="mt-1 text-[13px] text-fg-muted">
            You&apos;re set up. Start new campaigns from the <Link href="/dashboard" className="text-fg underline-offset-4 hover:underline">Overview</Link>, or <Link href="/dashboard/brain" className="text-fg underline-offset-4 hover:underline">watch Migz work</Link>.
          </p>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-fg-muted">
              {ready
                ? "This starts your first campaign. Migz sets it up and makes every ad for it on day one. In Ask me first mode, nothing goes live until you approve it."
                : `Finish ${props.steps.length - doneCount} more step${props.steps.length - doneCount === 1 ? "" : "s"} to start.`}
            </p>
            {!props.connected && ready && (
              <p className="mt-2 text-[13px] text-brand">Your Meta ad account isn&apos;t linked yet. Once we accept your partner request (step 2), this button will work.</p>
            )}
            {launchError && <p className="mt-2 text-[13px] text-bad">{launchError}</p>}
            <Button className="mt-4 bg-brand text-brand-fg hover:bg-brand/90" disabled={!ready || launching || !props.connected} onClick={launch}>
              {launching ? <Loader2 className="animate-spin" /> : null}
              Start my campaign
            </Button>
          </>
        )}
      </Panel>
    </div>
  );
}
