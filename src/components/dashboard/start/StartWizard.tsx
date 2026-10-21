"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { launchCampaign, savePlan, setCreativeMode } from "@/app/dashboard/actions";
import { AddFunds } from "@/components/dashboard/FundsControls";
import { ProfileForm, type Profile } from "@/components/dashboard/LandingEditor";
import { Button, Label, Panel, inputClass } from "@/components/dashboard/ui";
import { BUDGETS, DURATIONS, estimate } from "@/lib/campaign";
import { usd } from "@/lib/dashboard/format";
import { cleanFocus, MAX_FOCUS, TOPIC_KEYS, TOPICS, type TopicKey } from "@/lib/migz/topics";
import { cn } from "@/lib/utils";

type StepState = { key: string; done: boolean; missing: string | null };

type Props = {
  steps: StepState[];
  profile: Profile;
  slug: string;
  balanceCents: number;
  stripeConnected: boolean;
  connected: boolean; // Meta ad account linked and Migz configured
  plan: { topics: string[]; days: number | null; dailyCents: number };
  creativeMode: "upload" | "ai" | "both" | null;
  creativeCount: number;
  contactEmail: string;
  completed: boolean;
};

const TITLES: Record<string, { title: string; blurb: string }> = {
  profile: { title: "Your profile", blurb: "Your name, photo and a short bio. People see this before they book." },
  page: { title: "Your booking page", blurb: "The hours you take calls, and a look at the page your ads send people to." },
  funds: { title: "Add funds", blurb: "Money for your Meta ads. Migz spends it where it books the most calls." },
  plan: { title: "Plan your campaign", blurb: "What to promote, how long to run, and how much to spend each day." },
  creatives: { title: "Videos and images", blurb: "Let Migz make your ads' videos and photos, or bring your own." },
};

function StepShell({
  index,
  stepKey,
  done,
  summary,
  open,
  onToggle,
  children,
}: {
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
          <span className="block text-sm font-semibold text-fg">{TITLES[stepKey].title}</span>
          <span className="block truncate text-[13px] text-fg-muted">{done ? summary : TITLES[stepKey].blurb}</span>
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

function PlanStep({ plan, balanceCents, onSaved }: { plan: Props["plan"]; balanceCents: number; onSaved: () => void }) {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicKey[]>(cleanFocus(plan.topics));
  const [days, setDays] = useState<number | null>(plan.days);
  const [daily, setDaily] = useState<string>(String(Math.round(plan.dailyCents / 100)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dailyCents = Math.round(Number(daily.replace(/[^0-9.]/g, "")) * 100) || 0;
  const est = estimate(dailyCents, days, balanceCents);

  const toggle = (k: TopicKey) => {
    setSaved(false);
    setTopics((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= MAX_FOCUS ? cur : [...cur, k]));
  };

  const save = () =>
    start(async () => {
      setError(null);
      if (days === null) return setError("Pick how long the campaign should run.");
      const res = await savePlan({ topics, days, dailyCents });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
      onSaved();
    });

  return (
    <div className="space-y-6">
      <div>
        <Label>What do you want to promote?</Label>
        <p className="mb-2 text-[12px] text-fg-faint">Pick up to {MAX_FOCUS}. The first one is your main focus, and Migz makes most of your ads about it.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOPIC_KEYS.map((k) => {
            const rank = topics.indexOf(k);
            const on = rank >= 0;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                disabled={!on && topics.length >= MAX_FOCUS}
                onClick={() => toggle(k)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-40",
                  on ? "border-brand/50 bg-brand/[0.07]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
                )}
              >
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px]", on ? "bg-brand text-brand-fg" : "border border-line-strong text-transparent")}>
                  {on ? rank + 1 : "·"}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">{TOPICS[k].label}</span>
                  <span className="block text-[12px] text-fg-muted">{TOPICS[k].pitch}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>How long should it run?</Label>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.label}
              type="button"
              aria-pressed={days === d.days}
              onClick={() => {
                setDays(d.days);
                setSaved(false);
              }}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm transition-colors",
                days === d.days ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="daily">How much per day?</Label>
        <div className="flex flex-wrap items-center gap-2">
          {BUDGETS.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={dailyCents === b * 100}
              onClick={() => {
                setDaily(String(b));
                setSaved(false);
              }}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm transition-colors",
                dailyCents === b * 100 ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              ${b}
            </button>
          ))}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint">$</span>
            <input
              id="daily"
              inputMode="decimal"
              className={cn(inputClass, "w-28 pl-6")}
              value={daily}
              onChange={(e) => {
                setDaily(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <span className="text-[13px] text-fg-muted">a day</span>
        </div>
        <p className="mt-2 text-[13px] text-fg-muted">
          {dailyCents < 500
            ? "The minimum is $5 a day."
            : days === null
              ? "Pick a length to see the total."
              : est.totalCents !== null
                ? `About ${usd(est.totalCents)} over ${days} days. Your balance covers ${est.coveredDays} day${est.coveredDays === 1 ? "" : "s"}${est.fullyFunded ? ", the whole campaign." : `, so add ${usd(est.shortfallCents ?? 0)} more to cover it all.`}`
                : `It runs until you stop it. Your balance covers ${est.coveredDays} day${est.coveredDays === 1 ? "" : "s"} at this rate.`}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={pending || !topics.length || days === null}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save plan
        </Button>
        {saved && <span className="text-[13px] text-good">Saved</span>}
        {error && <span className="text-[13px] text-bad">{error}</span>}
      </div>
    </div>
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
  const doneCount = props.steps.filter((s) => s.done).length;
  const firstTodo = props.steps.find((s) => !s.done)?.key ?? null;
  const [open, setOpen] = useState<string | null>(firstTodo);
  const [launching, startLaunch] = useTransition();
  const [launchError, setLaunchError] = useState<string | null>(null);

  const stateOf = (k: string) => props.steps.find((s) => s.key === k)!;
  const ready = doneCount === props.steps.length;
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
    profile: props.profile.full_name,
    page: `Live at /${props.slug}`,
    funds: `${usd(props.balanceCents, { cents: true })} available`,
    plan: `${cleanFocus(props.plan.topics).map((t) => TOPICS[t].label).join(", ")} · ${usd(props.plan.dailyCents)}/day · ${DURATIONS.find((d) => d.days === props.plan.days)?.label.toLowerCase() ?? ""}`,
    creatives: props.creativeMode === "ai" ? "Migz creates them" : props.creativeMode === "upload" ? `${props.creativeCount} of your own` : "Yours plus Migz's",
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="mb-6">
        <div className="mb-2 flex items-baseline justify-between text-[13px]">
          <span className="text-fg-muted">{props.completed ? "Your campaign is set up." : `${doneCount} of ${props.steps.length} steps done`}</span>
          {!props.completed && <span className="text-fg-faint">About 10 minutes</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${(doneCount / props.steps.length) * 100}%` }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
        </div>
      </div>

      <StepShell index={1} stepKey="profile" done={stateOf("profile").done} summary={summaries.profile} open={open === "profile"} onToggle={() => setOpen(open === "profile" ? null : "profile")}>
        <ProfileForm profile={props.profile} onSaved={() => advance("profile")} />
      </StepShell>

      <StepShell index={2} stepKey="page" done={stateOf("page").done} summary={summaries.page} open={open === "page"} onToggle={() => setOpen(open === "page" ? null : "page")}>
        <div className="space-y-4">
          {stateOf("page").missing && <p className="text-[13px] text-brand">{stateOf("page").missing}</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            <Link href="/dashboard/calendar" className="rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-white/[0.03]">
              <span className="block text-sm font-medium text-fg">Set your hours</span>
              <span className="mt-1 block text-[12px] text-fg-muted">When people can book a call with you.</span>
            </Link>
            <Link href="/dashboard/questions" className="rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-white/[0.03]">
              <span className="block text-sm font-medium text-fg">Your questions</span>
              <span className="mt-1 block text-[12px] text-fg-muted">What you ask people after they book. Optional.</span>
            </Link>
            <a href={`/${props.slug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-white/[0.03]">
              <span className="flex items-center gap-1 text-sm font-medium text-fg">View your page <ArrowUpRight className="size-3.5" /></span>
              <span className="mt-1 block text-[12px] text-fg-muted">Exactly what your ads link to.</span>
            </a>
          </div>
          <p className="text-[12px] text-fg-faint">Your title, headline and testimonials are on the My page tab when you want to polish them.</p>
        </div>
      </StepShell>

      <StepShell index={3} stepKey="funds" done={stateOf("funds").done} summary={summaries.funds} open={open === "funds"} onToggle={() => setOpen(open === "funds" ? null : "funds")}>
        <div className="-mx-5 -my-5">
          <div className="border-b border-line px-5 py-4">
            <p className="text-[13px] text-fg-muted">Available balance</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{usd(props.balanceCents, { cents: true })}</p>
          </div>
          <AddFunds />
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

      <StepShell index={4} stepKey="plan" done={stateOf("plan").done} summary={summaries.plan} open={open === "plan"} onToggle={() => setOpen(open === "plan" ? null : "plan")}>
        <PlanStep plan={props.plan} balanceCents={props.balanceCents} onSaved={() => advance("plan")} />
      </StepShell>

      <StepShell index={5} stepKey="creatives" done={stateOf("creatives").done} summary={summaries.creatives} open={open === "creatives"} onToggle={() => setOpen(open === "creatives" ? null : "creatives")}>
        <CreativesStep mode={props.creativeMode} count={props.creativeCount} onSaved={() => advance("creatives")} />
      </StepShell>

      <Panel className={cn("mt-6 px-5 py-5", ready && !props.completed && "border-brand/40")}>
        <h2 className="text-sm font-semibold text-fg">{props.completed ? "Your campaign" : "Start your campaign"}</h2>
        {props.completed ? (
          <p className="mt-1 text-[13px] text-fg-muted">
            You&apos;re set up. Changes you make above apply to your next review. <Link href="/dashboard/brain" className="text-fg underline-offset-4 hover:underline">Watch Migz work</Link>.
          </p>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-fg-muted">
              {ready
                ? "Migz reviews your account, then proposes your first ads. In Ask me first mode, nothing goes live until you approve it."
                : `Finish ${props.steps.length - doneCount} more step${props.steps.length - doneCount === 1 ? "" : "s"} to start.`}
            </p>
            {!props.connected && ready && (
              <p className="mt-2 text-[13px] text-brand">Your Meta ad account isn&apos;t linked yet. Anryh Labs links it for you, and then this button will work.</p>
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
