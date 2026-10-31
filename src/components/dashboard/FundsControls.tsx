"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { setAdsPaused, startDeposit } from "@/app/dashboard/actions";
import { usd } from "@/lib/dashboard/format";
import { adSpendCents, FEE_RATE, TEST_DAYS } from "@/lib/campaign";
import { FUNDS_STEP_CENTS, roundUpToFundsStep } from "@/lib/campaign-plan";
import { Button, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// Funds come in $500 steps, so the amount reads as what a campaign really needs
const PRESETS = [1, 2, 3, 4].map((n) => ({ cents: n * FUNDS_STEP_CENTS, perDay: Math.floor(adSpendCents(n * FUNDS_STEP_CENTS) / TEST_DAYS / 100) }));

export function AddFunds() {
  const [amount, setAmount] = useState<number>(FUNDS_STEP_CENTS);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const typed = Math.round(Number(custom.replace(/[^0-9.]/g, "")) * 100);
  // A typed amount rounds up to the next $500 step
  const cents = custom ? (typed > 0 ? roundUpToFundsStep(typed) : 0) : amount;
  const forAds = adSpendCents(cents);
  // The daily spend this deposit pays for over two weeks
  const perDay = Math.floor(forAds / TEST_DAYS / 100) * 100;

  const go = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await startDeposit(cents);
      if (res.ok) window.location.href = res.url;
      else setMessage(res.error);
    });

  return (
    <div className="px-6 py-5">
      <p className="mb-3 text-sm font-medium">Add funds</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p.cents}
            type="button"
            onClick={() => {
              setAmount(p.cents);
              setCustom("");
            }}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              !custom && amount === p.cents
                ? "border-brand bg-brand/10 text-fg"
                : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            <span className="block text-sm font-medium tabular-nums">{usd(p.cents)}</span>
            <span className="block text-[11px] text-fg-faint">${p.perDay}/day</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint">$</span>
          <input
            inputMode="decimal"
            aria-label="Custom amount"
            placeholder={`Other amount (in ${usd(FUNDS_STEP_CENTS)} steps)`}
            className={`${inputClass} pl-7`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
        <Button variant="primary" onClick={go} disabled={pending || !cents || cents < 0}>
          {pending ? "Starting…" : `Add ${cents > 0 ? usd(cents) : "funds"}`}
        </Button>
      </div>
      <p className="relative mt-3 text-[13px] text-fg-muted">
        {cents > 0 ? (
          <>
            {custom && typed > 0 && typed !== cents ? `Rounded up to ${usd(cents)}: funds come in ${usd(FUNDS_STEP_CENTS)} steps. ` : ""}
            {`${usd(forAds)} goes to your ads, ${usd(cents - forAds, { cents: (cents - forAds) % 100 !== 0 })} is the Anryh Labs fee (${FEE_RATE * 100}%). That runs your ads at about ${usd(perDay, { cents: false })}/day for 2 weeks. `}
            <WhyFee />
          </>
        ) : null}
      </p>
      <AnimatePresence>
        {message && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden text-[13px] text-fg-muted"
          >
            {message}
          </motion.p>
        )}
      </AnimatePresence>
      <p className="mt-3 text-xs text-fg-faint">Card payments are processed securely by Stripe.</p>
    </div>
  );
}

/**
 * "Why 20%?": what the fee pays for. Opens on hover or keyboard focus, and on tap for phones. The note
 * spans the line above the text (positioned on the paragraph), so it never runs off a narrow screen.
 */
function WhyFee() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // A tap also fires hover and focus first, so it opens rather than toggles; a tap elsewhere closes it
        onClick={() => setOpen(true)}
        className="whitespace-nowrap text-brand underline decoration-brand/50 decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:decoration-solid"
      >
        Why {FEE_RATE * 100}%?
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 z-20 mb-2 block w-full max-w-sm rounded-lg border border-line-strong bg-ink px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-muted shadow-lg shadow-black/40"
          >
            <span className="block font-medium text-fg">What the {FEE_RATE * 100}% covers</span>
            Everything Migz does for you besides the ad spend itself: any creatives it generates for your ads (images and
            videos), and the AI cost of managing your ads every day: reviewing results, adjusting budgets and launching new tests.
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

/** Daily spend comes from the agent's campaign batch (Migz plans it); the agent can still pause everything. */
export function BudgetControls({ dailyBudgetCents, paused, batchLabel }: { dailyBudgetCents: number; paused: boolean; batchLabel: string | null }) {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(paused);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const togglePause = (v: boolean) =>
    startTransition(async () => {
      setIsPaused(v);
      const res = await setAdsPaused(v);
      if (!res.ok) {
        setIsPaused(!v);
        setError(res.error);
      }
      router.refresh();
    });

  return (
    <div className="space-y-5 px-5 py-5">
      <div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{batchLabel ? `${usd(dailyBudgetCents)}/day` : "—"}</p>
        <p className="mt-2 text-[13px] text-fg-muted">
          {batchLabel
            ? `Set by your ${batchLabel}. Migz may spend a little more on strong days and less on slow ones, but it stays within the batch.`
            : "Your daily spend is set when you start a campaign batch from the Overview."}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
        <div>
          <p className="text-sm font-medium">Pause ads</p>
          <p className="text-[13px] text-fg-muted">Stops all spending until you turn them back on.</p>
        </div>
        <Switch label="Pause ads" checked={isPaused} onChange={togglePause} disabled={pending} />
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </div>
  );
}
