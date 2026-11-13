"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { chooseVertical, launchCampaign, saveBatchPlan, saveCrm, saveLeadGoal, setCreativeMode, startSetupFee } from "@/app/dashboard/actions";
import { BrandSetup, type BrandInitial } from "@/components/dashboard/BrandSetup";
import { PresenterSetup, type PresenterInitial } from "@/components/dashboard/PresenterSetup";
import { CreativeContext, type CreativeContextInitial } from "@/components/dashboard/CreativeContext";
import { CRMS, LEAD_GOALS, leadOffer, type LeadGoal } from "@/lib/roofing/setup-options";
import { MIGZ_MONTHLY_CENTS, SETUP_FEE_CENTS } from "@/lib/campaign";
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
import { GoogleAdsSetup, type GoogleSetupInitial } from "@/components/dashboard/GoogleAdsSetup";
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
  verticalChosen: boolean; // setup's first question answered
  crm: string;
  leadGoal: LeadGoal | null;
  brand: BrandInitial | null; // roofers: their special, certifications, warranties and look
  presenter: PresenterInitial | null; // roofers: who's on camera
  context: CreativeContextInitial | null; // roofers: their voice, job photos and clips
  google: GoogleSetupInitial | null; // roofers: their Google Ads account
};

const TITLES: Record<string, { title: string; blurb: string }> = {
  vertical: { title: "What kind of business?", blurb: "Setup and your ads are built for your trade." },
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
  setup_fee: { title: `Migz AI: ${usd(MIGZ_MONTHLY_CENTS, { cents: false })}/month`, blurb: "No setup fee, cancel anytime. Every dollar of ad funds you add goes to your ads." },
  profile: { title: "Your company", blurb: "Your company name, logo or photo and a short intro. Homeowners see this before they talk to you." },
  crm: { title: "Your CRM", blurb: "Leads are booked straight into your CRM's calendar. Tell us which one you use." },
  slack: { title: "Slack (optional)", blurb: "New leads also come to your email. Connect Slack if you'd like them there too." },
  plan: { title: "Plan your first campaign", blurb: "What your ads lead with, where you work and a daily budget. Migz makes the ads." },
  rules: { title: "Jobs you take", blurb: "What your ads offer (a free inspection or a free quote) and the jobs you want. Your assistant only books the right ones." },
  details: { title: "Your special, certifications and warranties", blurb: "What every video can feature: this campaign's special, the certifications you hold and your warranties." },
  avatar: { title: "Who's on camera (optional)", blurb: "For person-to-camera ads: who appears, their photo and their voice. Skip it for ads with no person." },
  google: { title: "Google Ads (optional)", blurb: "Search ads for homeowners looking for a roofer right now. Migz builds and runs the campaign in your own Google Ads account." },
  media: { title: "Ad Creative AI Context (optional)", blurb: "Your voice and your real job photos and clips. Migz uses them in every ad: your voice in the videos, your photos in the videos and the image ads." },
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

/** Step 3: the one-time setup fee (roofers: the Migz AI subscription), paid on Stripe's page. Done when Stripe confirms it. */
function SetupFeeStep({ stripeConnected, contactEmail, roof }: { stripeConnected: boolean; contactEmail: string; roof: boolean }) {
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
      {roof ? (
        <>
          <ul className="space-y-1.5 text-[13px] text-fg-muted">
            <li>· Migz AI runs your Meta ads every day: campaigns, budgets and new ads</li>
            <li>· Video ads with real hooks, your towns and your certifications, sent to you for approval</li>
            <li>· Your booking page, inspection reminders and a summary every 3 days</li>
          </ul>
          <p className="text-[13px] text-fg-muted">{usd(MIGZ_MONTHLY_CENTS, { cents: false })} a month, billed today and monthly after. No setup fee, no contract. Your ad spend is separate, and all of it goes to your ads.</p>
        </>
      ) : (
        <>
          <ul className="space-y-1.5 text-[13px] text-fg-muted">
            <li>· Your Meta ad account, page and lead form connected and checked</li>
            <li>· Your first campaign planned and built, with its ads made for you</li>
            <li>· Your booking page and calendar ready for calls</li>
          </ul>
          <p className="text-[13px] text-fg-muted">
            Paid once. After this, the only cost is the fee on the ad funds you add (20%, then 12% once you&apos;ve added $20,000 in all).
          </p>
        </>
      )}
      {stripeConnected ? (
        <Button className="bg-[#ff7a1a] text-white hover:bg-[#ff7a1a]/90" disabled={pending} onClick={pay}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {roof ? `Start Migz AI, ${usd(MIGZ_MONTHLY_CENTS, { cents: false })}/month` : `Pay ${usd(SETUP_FEE_CENTS, { cents: false })} setup fee`}
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

/** Step 1: roofing company or insurance agent. Everything after it is built for the answer. */
function VerticalStep({ current, chosen, onSaved }: { current: "roofing" | "insurance"; chosen: boolean; onSaved: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (v: "roofing" | "insurance") =>
    start(async () => {
      setError(null);
      const res = await chooseVertical(v);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onSaved();
    });
  const options = [
    { value: "roofing", title: "Roofing company", detail: "Meta ads that bring homeowners in for a free inspection or quote, booked into your CRM." },
    { value: "insurance", title: "Insurance agent", detail: "Meta ads that book calls with people shopping for life insurance." },
  ] as const;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={pending}
            aria-pressed={chosen && current === o.value}
            onClick={() => pick(o.value)}
            className={cn("rounded-lg border px-4 py-3 text-left transition-colors", chosen && current === o.value ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]")}
          >
            <span className="block text-sm font-medium text-fg">{o.title}</span>
            <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{o.detail}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}

/** Roofers: the CRM they book in (replaces the booking page). */
function CrmStep({ initial, onSaved }: { initial: string; onSaved: () => void }) {
  const router = useRouter();
  const known = (CRMS as readonly string[]).includes(initial);
  const [picked, setPicked] = useState(initial ? (known ? initial : "Other") : "");
  const [other, setOther] = useState(known ? "" : initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveCrm(picked === "Other" ? other : picked);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onSaved();
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[...CRMS, "Other"].map((c) => (
          <button key={c} type="button" aria-pressed={picked === c} onClick={() => setPicked(c)} className={cn("rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors", picked === c ? "border-brand bg-brand/15 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}>
            {c}
          </button>
        ))}
      </div>
      {picked === "Other" && <input value={other} onChange={(e) => setOther(e.target.value)} maxLength={60} placeholder="Which CRM?" className="w-full rounded-lg border border-line bg-ink-high px-3 py-2 text-sm text-fg" />}
      <p className="text-[12px] text-fg-muted">We&apos;ll connect your calendar so new leads are booked right into it. No CRM yet? Pick None yet and we&apos;ll set you up.</p>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !picked || (picked === "Other" && !other.trim())}>{pending ? "Saving…" : "Save"}</Button>
        {error && <span className="text-[13px] text-bad">{error}</span>}
      </div>
    </div>
  );
}

/** Roofers: what every ad offers, above the jobs they take. */
function LeadGoalPicker({ initial }: { initial: LeadGoal | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (g: LeadGoal) =>
    start(async () => {
      setPicked(g);
      setError(null);
      const res = await saveLeadGoal(g);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-fg">What your ads offer</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {LEAD_GOALS.map((g) => (
          <button key={g.id} type="button" disabled={pending} aria-pressed={picked === g.id} onClick={() => pick(g.id)} className={cn("rounded-lg border px-4 py-3 text-left transition-colors", picked === g.id ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]")}>
            <span className="block text-sm font-medium text-fg">{g.title}</span>
            <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{g.detail}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
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
  // Until the first question is answered, it's the only step shown
  const shown = props.verticalChosen ? props.steps : props.steps.filter((s) => s.key === "vertical");
  const required = (k: string) => k !== "avatar" && k !== "media" && k !== "google" && !(roof && k === "slack");
  const counted = props.steps.filter((s) => required(s.key));
  const doneCount = counted.filter((s) => s.done).length;
  const firstTodo = shown.find((s) => !s.done && required(s.key))?.key ?? null;
  const [open, setOpen] = useState<string | null>(firstTodo);
  const [launching, startLaunch] = useTransition();
  const [launchError, setLaunchError] = useState<string | null>(null);

  const stateOf = (k: string) => props.steps.find((s) => s.key === k)!;
  const ready = doneCount === counted.length;
  const advance = (from: string) => {
    // After finishing a step, open the next unfinished one
    const order = props.steps.map((s) => s.key);
    const next = order.slice(order.indexOf(from) + 1).find((k) => !stateOf(k).done && required(k));
    setOpen(next ?? null);
  };

  const launch = () =>
    startLaunch(async () => {
      setLaunchError(null);
      const res = await launchCampaign();
      if (!res.ok) return setLaunchError(res.error);
      router.push("/dashboard/brain?started=1");
    });

  const summaries: Record<string, string> = {
    vertical: roof ? "Roofing company" : "Insurance agent",
    business: roof ? props.business.business_email || "Saved" : props.business.agency_name,
    meta: props.meta.linked ? `Ad account ${props.meta.linked.adAccount}` : "",
    slack: "Connected",
    setup_fee: props.setupFeePaidAt ? `${roof ? "Started" : "Paid"} ${new Date(props.setupFeePaidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "",
    profile: props.profile.full_name,
    page: props.booking.choice === "own" ? `Your own page: ${props.booking.ownUrl.replace(/^https?:\/\//, "")}` : `Live at /${props.slug}`,
    crm: props.crm,
    rules: `${leadOffer({ lead_goal: props.leadGoal }).title} · ${props.jobRules?.jobTypes.length ?? 0} kind${props.jobRules?.jobTypes.length === 1 ? "" : "s"} of job`,
    details: props.brand?.deals[0] ? `Special: ${props.brand.deals[0]}` : "Saved",
    avatar: props.presenter?.mode === "none" ? "No person" : props.presenter?.onCameraName ? `${props.presenter.onCameraName}, ${props.presenter.onCameraRole}` : "Saved",
    media: [props.context?.adVoice.name ? `Voice: ${props.context.adVoice.name}` : props.context?.voice ? "Your voice" : null, `${props.context?.media.length ?? 0} photos and clips`].filter(Boolean).join(" · "),
    google: props.google?.account ? `${props.google.account.status === "pending" ? "Waiting for you to accept" : "Linked"} · $${(props.google.account.monthlyCapCents / 100).toLocaleString("en-US")}/month` : "",
    funds: `${usd(props.balanceCents, { cents: true })} available`,
    plan: props.plan.batch
      ? `${usd(props.plan.batch.daily_cents, { cents: false })}/day, rolling · ${listCampaignTopics(props.plan.batch.campaigns.map((t) => (t || null) as CampaignSlot))}`
      : cleanFocus(props.plan.topics).map((t) => TOPICS[t].label).join(", "),
    mode: props.migzMode === "auto" ? "Migz runs it" : "Ask me first",
    creatives: props.creativeMode === "ai" ? "Migz creates them" : props.creativeMode === "upload" ? `${props.creativeCount} of your own` : "Yours plus Migz's",
  };

  const body: Record<string, React.ReactNode> = {
    vertical: <VerticalStep current={roof ? "roofing" : "insurance"} chosen={props.verticalChosen} onSaved={() => advance("vertical")} />,
    business: <BusinessStep initial={props.business} roof={roof} onSaved={() => advance("business")} />,
    meta: <MetaStep {...props.meta} onSaved={() => advance("meta")} />,
    setup_fee: <SetupFeeStep stripeConnected={props.stripeConnected} contactEmail={props.contactEmail} roof={roof} />,
    profile: <ProfileForm profile={props.profile} onSaved={() => advance("profile")} />,
    page: <BookingStep {...props.booking} slug={props.slug} onSaved={() => advance("page")} />,
    crm: <CrmStep initial={props.crm} onSaved={() => advance("crm")} />,
    rules: (
      <div className="space-y-6">
        <LeadGoalPicker initial={props.leadGoal} />
        <JobRulesForm initial={props.jobRules ?? null} required onSaved={() => advance("rules")} />
      </div>
    ),
    details: props.brand && <BrandSetup initial={props.brand} details onSaved={() => advance("details")} />,
    avatar: props.presenter && <PresenterSetup initial={props.presenter} inSetup onSaved={() => advance("avatar")} />,
    media: props.context && <CreativeContext initial={props.context} />,
    google: props.google && <GoogleAdsSetup initial={props.google} onSaved={() => advance("google")} />,
    slack: <SlackStep current={props.slack.current} inviteUrl={props.slack.inviteUrl} contactEmail={props.contactEmail} onSaved={() => advance("slack")} />,
    plan: <PlanStep plan={props.plan} balanceCents={props.balanceCents} onSaved={() => advance("plan")} />,
    funds: (
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
          {!roof && (
            <p className="mt-2 text-[13px] text-fg-muted">
              <span className="text-fg">Booked-call guarantee:</span> keep your campaign funded and running for its first 30 days, on your Anryh Labs booking page with your calendar
              open, and get {TARGET_LOW} booked calls ({TARGET_HIGH} at $75/day or more), or we credit back your Anryh Labs fee.
            </p>
          )}
        </div>
        <AddFunds addedBeforeCents={props.fundsAddedCents} plan={roof ? "subscription" : "percent"} />
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
    ),
    creatives: <CreativesStep mode={props.creativeMode} count={props.creativeCount} onSaved={() => advance("creatives")} />,
    mode: <MigzModeStep current={props.migzMode} onSaved={() => advance("mode")} />,
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

      {shown.map((s, i) => (
        <StepShell key={s.key} roof={roof} index={i + 1} stepKey={s.key} done={s.done} summary={summaries[s.key] ?? "Saved"} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)}>
          {body[s.key]}
        </StepShell>
      ))}

      {props.verticalChosen && (
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
                  : `Finish ${counted.length - doneCount} more step${counted.length - doneCount === 1 ? "" : "s"} to start.`}
              </p>
              {!props.connected && ready && (
                <p className="mt-2 text-[13px] text-brand">Your Meta ad account isn&apos;t linked yet. Once we accept your partner request, this button will work.</p>
              )}
              {launchError && <p className="mt-2 text-[13px] text-bad">{launchError}</p>}
              <Button className="mt-4 bg-brand text-brand-fg hover:bg-brand/90" disabled={!ready || launching || !props.connected} onClick={launch}>
                {launching ? <Loader2 className="animate-spin" /> : null}
                Start my campaign
              </Button>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
