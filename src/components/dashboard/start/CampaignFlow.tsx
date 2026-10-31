"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { previewCampaign, type CampaignChoice, type CampaignPreview } from "@/app/dashboard/actions";
import { IntentPicker, VideoTierPicker } from "@/components/dashboard/AdChoices";
import { Button, inputClass } from "@/components/dashboard/ui";
import { usd } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";
import { TOPIC_KEYS, TOPICS, MAX_FOCUS, type TopicKey } from "@/lib/migz/topics";
import { VIDEO_TIERS, type IntentLevel, type VideoTier } from "@/lib/ad-options";
import { cycleSteps, runsTheCycle, WAVE_MAX, WAVE_MIN } from "@/lib/migz/cycle";
import {
  AGE_PRESETS,
  CALL_TIMES,
  CONTACT,
  DAILY_CHOICES,
  LANGUAGES,
  MAIN_PRODUCTS,
  MAX_CAMPAIGN_DAILY_CENTS,
  MIN_CAMPAIGN_DAILY_CENTS,
  PREMIUM_CHOICES,
  STATE_CODES,
  UNDERWRITING,
  campaignMoney,
  expectedResults,
  lengthReason,
  videoPriceFor,
  INCLUDED_VIDEOS,
  type CallTime,
  type CampaignAnswers,
  type ContactWay,
  type ExpectedLine,
  type Language,
  type OwnNumbers,
  type Underwriting,
} from "@/lib/campaign-plan";

// Starting a campaign, one question per screen. Most answers are a tap, the optional ones can be skipped,
// and everything is prefilled from the last campaign. The expected results update as the agent answers;
// the last screen is Migz AI's plan. Used on Start here (saves the first campaign) and on the Overview
// (starts the next one).

export type CampaignStart = {
  answers: CampaignAnswers;
  states: string[];
  intent: IntentLevel;
  tier: VideoTier;
  dailyCents: number;
  autoRun: boolean;
  renew: boolean;
};

type Result = { ok: true } | { ok: false; error: string };

const RUN_MODES = [
  { auto: true, title: "Let Migz run it", recommended: true, detail: "Migz launches ads and makes changes on its own, within the budget and guardrails. You get a Slack update every 3 days." },
  { auto: false, title: "Ask me first", recommended: false, detail: "Migz proposes each new ad and change. Nothing goes live until you approve it." },
] as const;

const whole = (cents: number) => usd(cents, { cents: cents % 100 !== 0 });

/** One tap-to-choose option. */
function Tile({ on, onClick, title, detail, badge, className }: { on: boolean; onClick: () => void; title: string; detail?: string; badge?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
        on ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
        className,
      )}
    >
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-brand bg-brand text-brand-fg" : "border-line-strong")}>
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">{title}</span>
          {badge && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">{badge}</span>}
        </span>
        {detail && <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{detail}</span>}
      </span>
    </button>
  );
}

function ResultLine({ line, compact }: { line: ExpectedLine; compact?: boolean }) {
  const r = line.perWeek;
  return (
    <div className={cn("min-w-0", !compact && "rounded-xl border border-line px-4 py-3")}>
      <p className="text-[12px] text-fg-muted">{line.unit === "booked call" ? "Booked calls" : "Instant-form leads"} a week{line.dailyCents ? ` at ${whole(line.dailyCents)}/day` : ""}</p>
      <p className="mt-0.5 text-fg">
        <span className="tabular-nums text-fg-muted">{r.low}–</span>
        <span className="text-2xl font-semibold tabular-nums">{r.mid}</span>
        <span className="tabular-nums text-fg-muted">–{r.high}</span>
      </p>
      <p className="text-[12px] text-fg-faint">
        about <span className="font-semibold text-fg-muted">{whole(line.cost.mid)}</span> each ({whole(line.cost.low)}–{whole(line.cost.high)}) · {line.follow}
      </p>
    </div>
  );
}

function Expected({ lines, notes, own, compact }: { lines: ExpectedLine[]; notes: string[]; own: boolean; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-line bg-white/[0.03]", compact ? "px-4 py-3" : "px-4 py-4")}>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{own ? "What to expect, from your own results" : "What to expect (typical for US life insurance on Meta)"}</p>
      <div className={cn("grid gap-3", lines.length > 1 && "sm:grid-cols-2")}>
        {lines.map((l) => (
          <ResultLine key={l.destination} line={l} compact />
        ))}
      </div>
      {!compact && notes.length > 0 && <ul className="mt-3 space-y-0.5 text-[12px] text-fg-muted">{notes.map((n) => <li key={n}>· {n}</li>)}</ul>}
      <p className="mt-2 text-[11px] text-fg-faint">A range, not a promise. Results vary week to week.</p>
    </div>
  );
}

export function CampaignFlow({
  initial,
  balanceCents,
  own,
  confirmLabel,
  onConfirm,
  needsBalance = true,
}: {
  initial: CampaignStart;
  balanceCents: number;
  own: OwnNumbers | null;
  confirmLabel: string;
  onConfirm: (choice: CampaignChoice) => Promise<Result>;
  /** Setup saves the plan before funds arrive (launch checks the balance); the overview needs it now. */
  needsBalance?: boolean;
}) {
  const [a, setA] = useState<CampaignAnswers>(initial.answers);
  const [states, setStates] = useState<string[]>(initial.states);
  const [intent, setIntent] = useState<IntentLevel>(initial.intent);
  const [tier, setTier] = useState<VideoTier>(initial.tier);
  const [daily, setDaily] = useState(initial.dailyCents);
  const [customDaily, setCustomDaily] = useState(DAILY_CHOICES.includes(initial.dailyCents as never) ? "" : String(initial.dailyCents / 100));
  const [autoRun, setAutoRun] = useState(initial.autoRun);
  const [renew, setRenew] = useState(initial.renew);
  const [moreProducts, setMoreProducts] = useState(a.products.some((p) => !MAIN_PRODUCTS.includes(p)));
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewing, startPreview] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CampaignAnswers>(k: K, v: CampaignAnswers[K]) => setA((cur) => ({ ...cur, [k]: v }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const money = useMemo(() => campaignMoney({ dailyCents: daily, intent, tier }), [daily, intent, tier]);
  const expected = useMemo(() => expectedResults({ answers: a, states, intent, dailyCents: daily, own }), [a, states, intent, daily, own]);
  const ownUsed = expected.lines.some((l) => l.source === "yours");
  const choice: CampaignChoice = { answers: a, states, intentLevel: intent, videoTier: tier, dailyCents: daily, autoRun, renew };

  const dailyOk = daily >= MIN_CAMPAIGN_DAILY_CENTS && daily <= MAX_CAMPAIGN_DAILY_CENTS;
  const ageLabel = a.ageMin === null && a.ageMax === null ? "Any adult" : `${a.ageMin ?? 18}–${a.ageMax ?? "90"}`;

  const screens: { key: string; q: string; help?: string; skip?: () => void; valid?: boolean; body: React.ReactNode }[] = [
    {
      key: "products",
      q: "What do you want to advertise?",
      help: `Pick up to ${MAX_FOCUS}, main one first. Migz makes the most ads for your first pick.`,
      valid: a.products.length > 0,
      body: (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {(moreProducts ? TOPIC_KEYS : MAIN_PRODUCTS).map((k: TopicKey) => {
              const rank = a.products.indexOf(k);
              return (
                <Tile
                  key={k}
                  on={rank >= 0}
                  onClick={() => set("products", rank >= 0 ? a.products.filter((p) => p !== k) : a.products.length >= MAX_FOCUS ? a.products : [...a.products, k])}
                  title={TOPICS[k].label}
                  detail={TOPICS[k].pitch}
                  badge={rank === 0 && a.products.length > 1 ? "Main" : undefined}
                />
              );
            })}
          </div>
          {!moreProducts && (
            <button type="button" className="text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline" onClick={() => setMoreProducts(true)}>
              More products
            </button>
          )}
        </div>
      ),
    },
    {
      key: "ages",
      q: "What ages do you write?",
      help: "Meta doesn't let insurance ads target by age, so Migz says it in the ads instead (\"for people 50–85\"). The right people answer, the rest scroll on.",
      skip: () => setA((c) => ({ ...c, ageMin: null, ageMax: null })),
      body: (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {AGE_PRESETS.map((p) => (
              <Tile key={p.label} on={a.ageMin === p.min && a.ageMax === p.max} onClick={() => setA((c) => ({ ...c, ageMin: p.min, ageMax: p.max }))} title={p.label} detail={p.detail} />
            ))}
            <Tile on={a.ageMin === null && a.ageMax === null} onClick={() => setA((c) => ({ ...c, ageMin: null, ageMax: null }))} title="Any adult" detail="No age in the ads." />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
            Or exactly:
            <input aria-label="Youngest age" inputMode="numeric" className={cn(inputClass, "w-20 tabular-nums")} value={a.ageMin ?? ""} onChange={(e) => set("ageMin", e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null)} />
            to
            <input aria-label="Oldest age" inputMode="numeric" className={cn(inputClass, "w-20 tabular-nums")} value={a.ageMax ?? ""} onChange={(e) => set("ageMax", e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null)} />
          </div>
        </div>
      ),
    },
    {
      key: "states",
      q: "Which states are you licensed in?",
      help: "Your ads only reach people in these states.",
      valid: states.length > 0,
      body: (
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
          {STATE_CODES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={states.includes(s)}
              onClick={() => setStates(toggle(states, s))}
              className={cn(
                "h-10 rounded-lg border font-mono text-[13px] transition-colors",
                states.includes(s) ? "border-brand/60 bg-brand/[0.12] text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      ),
    },
    {
      key: "premium",
      q: "What's the lowest monthly premium you'll write?",
      help: "Migz keeps price hooks honest: no ad promises less than this.",
      skip: () => set("minPremium", null),
      body: (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PREMIUM_CHOICES.map((p) => (
            <Tile key={p} on={a.minPremium === p} onClick={() => set("minPremium", p)} title={`$${p}/mo`} />
          ))}
        </div>
      ),
    },
    {
      key: "underwriting",
      q: "Medical exam, or no exam?",
      help: "\"No medical exam\" is one of the strongest hooks, so Migz only uses it when it's true.",
      skip: () => set("underwriting", null),
      body: (
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(UNDERWRITING) as Underwriting[]).map((k) => (
            <Tile key={k} on={a.underwriting === k} onClick={() => set("underwriting", k)} title={UNDERWRITING[k].title} detail={UNDERWRITING[k].detail} />
          ))}
        </div>
      ),
    },
    {
      key: "health",
      q: "Do you take people with health issues?",
      help: "Guaranteed issue: coverage without health questions. Ads can say health issues are OK only if you do.",
      skip: () => set("healthIssuesOk", null),
      body: (
        <div className="grid gap-2 sm:grid-cols-2">
          <Tile on={a.healthIssuesOk === true} onClick={() => set("healthIssuesOk", true)} title="Yes" detail="I offer guaranteed issue." />
          <Tile on={a.healthIssuesOk === false} onClick={() => set("healthIssuesOk", false)} title="No" detail="People need to qualify." />
        </div>
      ),
    },
    {
      key: "languages",
      q: "Which languages do you speak with clients?",
      help: "With Spanish, Migz makes part of your ads in Spanish. They usually cost less per lead.",
      valid: a.languages.length > 0,
      body: (
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(LANGUAGES) as Language[]).map((k) => (
            <Tile key={k} on={a.languages.includes(k)} onClick={() => set("languages", toggle(a.languages, k))} title={LANGUAGES[k]} />
          ))}
        </div>
      ),
    },
    {
      key: "contact",
      q: "How do you meet clients, and when can you take calls?",
      help: "So the ads promise what you'll actually do.",
      skip: () => setA((c) => ({ ...c, contact: null, callTimes: [] })),
      body: (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(CONTACT) as ContactWay[]).map((k) => (
              <Tile key={k} on={a.contact === k} onClick={() => set("contact", k)} title={CONTACT[k]} />
            ))}
          </div>
          <div>
            <p className="mb-2 text-[13px] text-fg-muted">When you take calls (pick any)</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(CALL_TIMES) as CallTime[]).map((k) => (
                <Tile key={k} on={a.callTimes.includes(k)} onClick={() => set("callTimes", toggle(a.callTimes, k))} title={CALL_TIMES[k]} />
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "intent",
      q: "What kind of leads do you want?",
      body: <IntentPicker value={intent} onChange={setIntent} idPrefix="flow-intent" />,
    },
    {
      key: "video",
      q: "Video quality",
      help: "Every campaign gets at least 2 videos per ad set, plus up to 10 images (images are always included).",
      body: <VideoTierPicker value={tier} onChange={setTier} idPrefix="flow-video" />,
    },
    {
      key: "budget",
      q: "How much a day?",
      help: "You pick the daily budget. Migz sets how long the campaign runs from it.",
      valid: dailyOk,
      body: (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {DAILY_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={!customDaily && daily === c}
                onClick={() => {
                  setDaily(c);
                  setCustomDaily("");
                }}
                className={cn(
                  "h-11 rounded-xl border text-sm tabular-nums transition-colors",
                  !customDaily && daily === c ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {whole(c)}/day
              </button>
            ))}
          </div>
          <div className="relative w-40">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint">$</span>
            <input
              aria-label="Other daily amount"
              inputMode="decimal"
              placeholder="Other"
              className={cn(inputClass, "pl-6 pr-12 tabular-nums")}
              value={customDaily}
              onChange={(e) => {
                setCustomDaily(e.target.value);
                const c = Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) * 100);
                if (c) setDaily(c);
              }}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-fg-faint">/day</span>
          </div>
          {!dailyOk && <p className="text-[13px] text-bad">Choose between {whole(MIN_CAMPAIGN_DAILY_CENTS)} and {whole(MAX_CAMPAIGN_DAILY_CENTS)} a day.</p>}
          {dailyOk && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-brand/30 bg-brand/[0.05] px-4 py-3">
                <p className="text-[12px] text-fg-muted">Migz runs it</p>
                <p className="text-2xl font-semibold tabular-nums text-fg">{money.days} days</p>
                <p className="mt-1 text-[12px] leading-snug text-fg-muted">{lengthReason(daily, money.days)}</p>
              </div>
              <div className="rounded-xl border border-line px-4 py-3">
                <p className="text-[12px] text-fg-muted">Ad funds for this campaign</p>
                <p className="text-2xl font-semibold tabular-nums text-fg">{whole(money.recommendedFundsCents)}</p>
                <p className="mt-1 text-[12px] leading-snug text-fg-muted">
                  {whole(daily)} × {money.days} days = {whole(money.adSpendCents)}
                  {money.videoCents ? `, plus ${whole(money.videoCents)} for ${VIDEO_TIERS[tier].title} videos` : ""}, rounded up to the next $500. Treat it as the minimum. You have {usd(balanceCents, { cents: true })}.
                </p>
              </div>
              <div className="rounded-xl border border-line px-4 py-3 sm:col-span-2">
                <p className="text-[12px] text-fg-muted">Ads Migz makes, all launched on day one</p>
                <p className="mt-1 text-sm text-fg">
                  {money.sets
                    .map((s) => `${s.mix.total} ${s.destination === "instant_form" ? "instant-form" : ""} ads: ${s.mix.videos} videos and ${s.mix.images} images`.replace("  ", " "))
                    .join(" · ")}
                </p>
                <p className="mt-1 text-[12px] text-fg-faint">
                  Each on a different angle (price, no exam, family, burial costs, age, testimonial style).{" "}
                  {runsTheCycle(money.days, renew)
                    ? `Meta learns for the first week; then, from day 8 and every two weeks after, Migz adds ${WAVE_MIN}–${WAVE_MAX} new ones together, built from what's winning.`
                    : `At ${money.days} days the campaign is too short to read new ads, so these are the ads it runs.`}
                </p>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "plan",
      q: "Migz AI's plan",
      body: <PlanScreen preview={preview} loading={previewing} needsBalance={needsBalance} autoRun={autoRun} setAutoRun={setAutoRun} renew={renew} setRenew={setRenew} money={money} tier={tier} />,
    },
  ];

  const screen = screens[step];
  const last = step === screens.length - 1;

  useEffect(() => {
    if (screen.key !== "plan") return;
    startPreview(async () => {
      setError(null);
      setPreview(await previewCampaign(choice));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.key]);

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setError(null);
    setStep(Math.max(0, Math.min(screens.length - 1, to)));
  };

  const confirm = () =>
    startConfirm(async () => {
      setError(null);
      const res = await onConfirm(choice);
      if (!res.ok) setError(res.error);
    });

  const blocked = needsBalance && preview?.ok && !!preview.short;
  const summary = [a.products.map((p) => TOPICS[p].label).join(", "), ageLabel, states.length ? `${states.length} state${states.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3 text-[12px]">
          <span className="truncate text-fg-faint">{summary}</span>
          <span className="shrink-0 tabular-nums text-fg-muted">
            {step + 1} of {screens.length}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div className="h-full rounded-full bg-brand" animate={{ width: `${((step + 1) / screens.length) * 100}%` }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={screen.key}
          custom={dir}
          initial={{ opacity: 0, x: dir * 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -16 }}
          transition={{ duration: 0.18 }}
          className="space-y-4"
        >
          <div>
            <h3 className="text-xl font-normal tracking-[-0.02em] text-fg sm:text-2xl">{screen.q}</h3>
            {screen.help && <p className="mt-1 text-[13px] leading-snug text-fg-muted">{screen.help}</p>}
          </div>
          {screen.body}
        </motion.div>
      </AnimatePresence>

      {screen.key !== "plan" && screen.key !== "products" && dailyOk && <Expected lines={expected.lines} notes={expected.notes} own={ownUsed} compact={screen.key !== "budget"} />}

      {error && <p className="text-[13px] text-bad">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {step > 0 && (
          <Button variant="ghost" onClick={() => go(step - 1)}>
            <ArrowLeft /> Back
          </Button>
        )}
        <span className="flex-1" />
        {screen.skip && !last && (
          <Button
            variant="ghost"
            onClick={() => {
              screen.skip!();
              go(step + 1);
            }}
          >
            Skip
          </Button>
        )}
        {last ? (
          <Button variant="primary" onClick={confirm} disabled={confirming || previewing || !preview?.ok || !!blocked}>
            {confirming ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => go(step + 1)} disabled={screen.valid === false}>
            Next <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}

function PlanScreen({
  preview,
  loading,
  needsBalance,
  autoRun,
  setAutoRun,
  renew,
  setRenew,
  money,
  tier,
}: {
  preview: CampaignPreview | null;
  loading: boolean;
  needsBalance: boolean;
  autoRun: boolean;
  setAutoRun: (v: boolean) => void;
  renew: boolean;
  setRenew: (v: boolean) => void;
  money: ReturnType<typeof campaignMoney>;
  tier: VideoTier;
}) {
  if (loading || !preview)
    return (
      <p className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" /> Migz is reading your past campaigns…
      </p>
    );
  if (!preview.ok) return <p className="text-[13px] text-bad">{preview.error}</p>;
  const p = preview.plan;
  return (
    <div className="space-y-4">
      <MigzPlan plan={p} renews={renew} />

      {money.videoCents > 0 && (
        <div className="rounded-xl border border-brand/30 bg-brand/[0.05] px-4 py-3 text-[13px]">
          <p className="font-semibold text-fg">You&apos;ll be charged {whole(money.videoCents)} for {VIDEO_TIERS[tier].title} videos</p>
          <p className="mt-1 text-fg-muted">
            {money.sets.map((s) => `${s.mix.videos} videos`).join(" + ")} at the start of the campaign, from your ad funds, shown in your funds history. Refunded if one can&apos;t be made or Meta rejects its ad.
            {runsTheCycle(money.days, renew) && ` A video in a later wave of new ads costs ${whole(videoPriceFor(tier, INCLUDED_VIDEOS))} (20% off), and Migz asks you before making one.`}
          </p>
        </div>
      )}
      {needsBalance && preview.short && <p className="text-[13px] text-bad">{preview.short}</p>}

      <div>
        <p className="mb-2 text-[13px] font-medium text-fg-muted">How should Migz run it?</p>
        <div role="radiogroup" aria-label="How Migz runs this campaign" className="grid gap-2 sm:grid-cols-2">
          {RUN_MODES.map((m) => (
            <Tile key={m.title} on={autoRun === m.auto} onClick={() => setAutoRun(m.auto)} title={m.title} detail={m.detail} badge={m.recommended ? "Recommended" : undefined} />
          ))}
        </div>
      </div>
      <Tile
        on={renew}
        onClick={() => setRenew(!renew)}
        title="Keep going"
        detail="When this campaign ends, the next one starts from your balance with the same daily budget, and Migz plans it from what this one learned. It never charges a card."
      />
    </div>
  );
}

/** Migz AI's plan for a campaign: what it learned (with the evidence), what it changes, budget and range. */
export function MigzPlan({ plan, renews = false }: { plan: NonNullable<Extract<CampaignPreview, { ok: true }>["plan"]>; renews?: boolean }) {
  // Plans saved before the creative cycle say nothing is added partway through; the cycle below replaces that
  const changes = plan.changes.filter((c) => !/nothing new is added partway/i.test(c));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand/30 bg-brand/[0.05] px-4 py-3">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
          <Sparkles className="size-3.5 text-brand" /> {whole(plan.budget.dailyCents)}/day for {plan.budget.days} days
          {plan.budget.recommendedDailyCents !== plan.budget.dailyCents && <span className="font-normal text-fg-muted">· Migz recommends {whole(plan.budget.recommendedDailyCents)}/day</span>}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-fg-muted">{plan.budget.why}</p>
      </div>

      {plan.learned.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-fg-muted">What Migz learned from your last campaigns</p>
          <ul className="space-y-2">
            {plan.learned.map((l, i) => (
              <li key={i} className="rounded-xl border border-line px-4 py-2.5">
                <p className="text-[13px] text-fg">{l.text}</p>
                <p className="mt-0.5 text-[12px] text-fg-faint">{l.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-[13px] font-medium text-fg-muted">{plan.first ? "How Migz starts" : "What it does differently this time"}</p>
        <ul className="space-y-1.5">
          {changes.map((c, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-fg">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
              {c}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-fg-muted">How the ads change over the campaign</p>
        <ol className="divide-y divide-line rounded-xl border border-line">
          {cycleSteps(plan.budget.days, renews).map((step) => (
            <li key={step.when} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
              <span className="shrink-0 text-[12px] font-medium tabular-nums text-fg sm:w-28">{step.when}</span>
              <span className="text-[13px] leading-snug text-fg-muted">{step.what}</span>
            </li>
          ))}
        </ol>
      </div>

      <Expected lines={plan.expected.lines} notes={plan.expected.notes} own={plan.expected.lines.some((l) => l.source === "yours")} />
    </div>
  );
}
