"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { planBatch, type BatchPlanResult } from "@/app/dashboard/actions";
import { Button, Label, inputClass } from "@/components/dashboard/ui";
import { depositFor } from "@/lib/campaign";
import { MIN_BATCH_CENTS, SPRINT_MIN_BATCH_CENTS, type BatchOptionKey } from "@/lib/batch";
import { usd } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

export type BatchChoice = { budgetCents: number; option: BatchOptionKey; recommended: BatchOptionKey; reason: string; autoRun: boolean; renew: boolean };

const RUN_MODES = [
  { auto: true, title: "Let Migz run it", detail: "Migz launches ads and makes changes on its own, within the budget and guardrails. You get a Slack update every 3 days with what it changed." },
  { auto: false, title: "Ask me first", detail: "Migz proposes each new ad and change. Nothing goes live until you approve it in the Brain or on the Overview." },
] as const;

const QUICK = [28_000, 42_000, 56_000, 70_000, 84_000]; // ad spend: $20, $30 and $40 a day for two weeks, $700 ($50/day for two weeks or $100/day for a week), $60 a day

const whole = (cents: number) => usd(cents, { cents: cents % 100 !== 0 });

/**
 * "How much do you want to put into this batch?" then Migz's options for spending it, with the one it
 * recommends for this agent. Used on Start here (saves the first batch) and on the Overview (starts one).
 */
export function BatchPlanner({
  topics,
  balanceCents,
  initialBudgetCents,
  confirmLabel,
  onConfirm,
  needsBalance = true,
  initialAutoRun = false,
}: {
  topics?: string[]; // setup passes the focus being edited; the overview uses the saved focus
  balanceCents: number;
  initialBudgetCents?: number;
  confirmLabel: string;
  onConfirm: (choice: BatchChoice) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Setup saves the plan before funds arrive (launch checks the balance); the overview needs it now. */
  needsBalance?: boolean;
  /** The agent's current mode (auto = Migz runs it), preselected in the choice. */
  initialAutoRun?: boolean;
}) {
  const [amount, setAmount] = useState(String(Math.round((initialBudgetCents ?? Math.max(MIN_BATCH_CENTS, Math.min(balanceCents, 56_000))) / 100)));
  const [plan, setPlan] = useState<Extract<BatchPlanResult, { ok: true }> | null>(null);
  const [picked, setPicked] = useState<BatchOptionKey | null>(null);
  const [planning, startPlanning] = useTransition();
  const [confirming, startConfirming] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [plannedFor, setPlannedFor] = useState(0);
  const [autoRun, setAutoRun] = useState(initialAutoRun);
  const [renew, setRenew] = useState(false);

  const budgetCents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100) || 0;
  const tooSmall = budgetCents > 0 && budgetCents < MIN_BATCH_CENTS;
  const overBalance = needsBalance && budgetCents > balanceCents;
  const stale = plan !== null && budgetCents !== plannedFor;

  const ask = (cents = budgetCents) =>
    startPlanning(async () => {
      setError(null);
      const res = await planBatch(cents, topics);
      if (!res.ok) {
        setPlan(null);
        return setError(res.error);
      }
      setPlan(res);
      setPlannedFor(cents);
      setPicked(res.recommended.key);
    });

  // Migz's advice: the batch that makes room for an exploration campaign, planned in one click
  const planWith = (cents: number) => {
    setAmount(String(cents / 100));
    ask(cents);
  };

  const confirm = () =>
    startConfirming(async () => {
      if (!plan || !picked) return;
      setError(null);
      const res = await onConfirm({ budgetCents: plannedFor, option: picked, recommended: plan.recommended.key, reason: plan.recommended.reason, autoRun, renew });
      if (!res.ok) setError(res.error);
    });

  const chosen = plan?.options.find((o) => o.key === picked) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="batch-amount">How much do you want to put into this batch?</Label>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={budgetCents === c}
              onClick={() => setAmount(String(c / 100))}
              className={cn(
                "rounded-lg border px-3.5 py-2 text-sm tabular-nums transition-colors",
                budgetCents === c ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {whole(c)}
            </button>
          ))}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint">$</span>
            <input
              id="batch-amount"
              inputMode="decimal"
              className={cn(inputClass, "w-32 pl-6 tabular-nums")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button onClick={() => ask()} disabled={planning || !budgetCents || tooSmall}>
            {planning ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {plan && !stale ? "Ask Migz again" : "See Migz's plan"}
          </Button>
        </div>
        <p className={cn("mt-2 text-[13px]", tooSmall ? "text-bad" : "text-fg-muted")}>
          {tooSmall
            ? `The smallest batch is ${whole(MIN_BATCH_CENTS)} of ad spend (a ${whole(depositFor(MIN_BATCH_CENTS))} deposit with the 20% fee).`
            : `This is ad spend from your balance (${usd(balanceCents, { cents: true })} available). Migz decides how to split it and for how long: two weeks or more, or a one-week sprint from ${whole(SPRINT_MIN_BATCH_CENTS)}.`}
          {budgetCents > balanceCents && !tooSmall && <span className="text-brand"> That&apos;s more than your balance; add {whole(depositFor(budgetCents - balanceCents))} in funds first.</span>}
        </p>
      </div>

      <AnimatePresence initial={false}>
        {planning && !plan && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[13px] text-fg-muted">
            <Loader2 className="size-3.5 animate-spin" /> Migz is looking at your results and planning the batch…
          </motion.p>
        )}
      </AnimatePresence>

      {plan && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: stale ? 0.5 : 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-4">
          <div className="rounded-lg border border-brand/30 bg-brand/[0.05] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
              <Sparkles className="size-3.5 text-brand" /> Migz recommends: {plan.options.find((o) => o.key === plan.recommended.key)?.title}
            </p>
            <p className="mt-1 text-[13px] text-fg-muted">{plan.recommended.reason}</p>
            <p className="mt-2 text-[12px] text-fg-faint">
              {plan.estimate
                ? `At your ${whole(plan.estimate.costPerCallCents)} per booked call so far, ${whole(plannedFor)} should bring roughly ${plan.estimate.low}–${plan.estimate.high} booked calls. Results vary week to week.`
                : plan.math}
            </p>
          </div>

          {plan.diagnosis && (
            <div className="rounded-lg border border-line px-4 py-3">
              <p className="text-[13px] font-semibold text-fg">
                {plan.diagnosis.fix === "page" ? "Your booking page is where people stop" : plan.diagnosis.fix === "both" ? "Your ads and page need to match" : "Your ads need more people"}
              </p>
              <p className="mt-1 text-[13px] text-fg-muted">{plan.diagnosis.text}</p>
            </div>
          )}

          {plan.advice && (
            <div className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-semibold text-fg">Make room to explore</p>
                <p className="mt-1 text-[13px] text-fg-muted">{plan.advice.message}</p>
                {needsBalance && plan.advice.totalCents > balanceCents && (
                  <p className="mt-1 text-[12px] text-fg-faint">That needs {whole(depositFor(plan.advice.totalCents - balanceCents))} more in funds (with the 20% fee).</p>
                )}
              </div>
              <Button onClick={() => planWith(plan.advice!.totalCents)} disabled={planning} className="shrink-0">
                Plan with {whole(plan.advice.totalCents)}
              </Button>
            </div>
          )}

          <div role="radiogroup" aria-label="How to spend this batch" className={cn("grid gap-2", plan.options.length > 3 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
            {plan.options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={picked === o.key}
                onClick={() => setPicked(o.key)}
                className={cn(
                  "flex flex-col rounded-lg border px-4 py-3 text-left transition-colors",
                  picked === o.key ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{o.title}</span>
                  {o.key === plan.recommended.key && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">Recommended</span>}
                </span>
                <span className="mt-1 font-mono text-[12px] text-fg-muted">
                  {o.exploreCents
                    ? `${whole(o.perCampaignCents)}/day main + ${whole(o.exploreCents)}/day exploring`
                    : o.campaigns.length === 1 ? `1 campaign · ${whole(o.perCampaignCents)}/day` : `${o.campaigns.length} campaigns · ${whole(o.perCampaignCents)}/day each`}{" "}
                  · {o.days} days
                </span>
                <span className="mt-2 text-[12px] leading-snug text-fg-muted">{o.blurb}</span>
              </button>
            ))}
          </div>

          {chosen && (
            <ol className="space-y-1 text-[13px] text-fg-muted">
              <li>
                <span className="mr-2 font-mono text-[11px] text-brand">1</span>Days 1–{chosen.collectDays}: Migz builds ads for {chosen.exploreCents ? "both campaigns" : chosen.campaigns.length === 1 ? "the campaign" : "every campaign"} and collects results. No changes while the data comes in.
              </li>
              <li>
                <span className="mr-2 font-mono text-[11px] text-brand">2</span>After {chosen.collectDays} days: it revises what&apos;s underperforming (hooks, copy{chosen.exploreCents ? ", and moves the winners from exploration into the main campaign" : chosen.campaigns.length > 1 ? ", budget between campaigns" : ""}).
              </li>
              <li>
                <span className="mr-2 font-mono text-[11px] text-brand">3</span>Through day {chosen.days}: it checks whether those changes actually brought more booked calls, and keeps what works.
              </li>
              <li className="pt-1 text-[12px] text-fg-faint">
                It never goes over {whole(plannedFor)}. Meta can spend up to 25% over a daily budget on a busy day, so Migz paces {chosen.days <= 7 ? "the whole week" : "the last week"} to leave room{chosen.days <= 7 ? ", which can keep a day a little under " + whole(chosen.dailyCents) : ""}, and the ads stop on day {chosen.days} on their own. Anything left over stays in your balance.
              </li>
            </ol>
          )}

          <div>
            <p className="mb-2 text-[13px] font-medium text-fg-muted">How should Migz run it?</p>
            <div role="radiogroup" aria-label="How Migz runs this batch" className="grid gap-2 sm:grid-cols-2">
              {RUN_MODES.map((m) => (
                <button
                  key={m.title}
                  type="button"
                  role="radio"
                  aria-checked={autoRun === m.auto}
                  onClick={() => setAutoRun(m.auto)}
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left transition-colors",
                    autoRun === m.auto ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
                  )}
                >
                  <span className="block text-sm font-medium text-fg">{m.title}</span>
                  <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{m.detail}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={renew}
            onClick={() => setRenew(!renew)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
              renew ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
            )}
          >
            <span aria-hidden="true" className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", renew ? "bg-brand" : "bg-white/[0.12]")}>
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-[left]", renew ? "left-[18px]" : "left-0.5")} />
            </span>
            <span>
              <span className="block text-sm font-medium text-fg">Keep going</span>
              <span className="mt-1 block text-[12px] leading-snug text-fg-muted">
                {chosen ? `When this batch ends, the same ${whole(plannedFor)} batch starts again from your balance, so the ads never stop between weeks. ` : ""}
                It only starts if your balance covers it (it never charges a card), and Migz can revise from day one. Turn it off any time from the batch card.
              </span>
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={confirm} disabled={confirming || !picked || !!stale || overBalance}>
              {confirming ? <Loader2 className="animate-spin" /> : null}
              {confirmLabel}
            </Button>
            {stale && <span className="text-[13px] text-fg-faint">You changed the amount. Ask Migz again to update the plan.</span>}
          </div>
        </motion.div>
      )}

      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}
