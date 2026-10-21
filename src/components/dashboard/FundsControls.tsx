"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { setAdsPaused, startDeposit, updateDailyBudget } from "@/app/dashboard/actions";
import { usd } from "@/lib/dashboard/format";
import { Button, Label, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

const PRESETS = [100_00, 250_00, 500_00, 1000_00];

export function AddFunds() {
  const [amount, setAmount] = useState<number>(250_00);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cents = custom ? Math.round(Number(custom.replace(/[^0-9.]/g, "")) * 100) : amount;

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
            key={p}
            type="button"
            onClick={() => {
              setAmount(p);
              setCustom("");
            }}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-sm font-medium tabular-nums transition-colors",
              !custom && amount === p
                ? "border-brand bg-brand/10 text-fg"
                : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {usd(p)}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint">$</span>
          <input
            inputMode="decimal"
            aria-label="Custom amount"
            placeholder="Other amount"
            className={`${inputClass} pl-7`}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
        <Button variant="primary" onClick={go} disabled={pending || !cents || cents < 0}>
          {pending ? "Starting…" : `Add ${cents > 0 ? usd(cents) : "funds"}`}
        </Button>
      </div>
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

export function BudgetControls({ dailyBudgetCents, paused }: { dailyBudgetCents: number; paused: boolean }) {
  const router = useRouter();
  const [dollars, setDollars] = useState(String(dailyBudgetCents / 100));
  const [isPaused, setIsPaused] = useState(paused);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cents = Math.round(Number(dollars) * 100);
  const dirty = cents !== dailyBudgetCents;

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await updateDailyBudget(cents);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });

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
        <Label htmlFor="budget">Per day</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint">$</span>
            <input
              id="budget"
              inputMode="decimal"
              className={`${inputClass} pl-7 tabular-nums`}
              value={dollars}
              onChange={(e) => setDollars(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </div>
          <Button onClick={save} disabled={pending || !dirty}>
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          aria-label="Daily budget slider"
          value={Math.min(200, Math.max(5, Number(dollars) || 5))}
          onChange={(e) => setDollars(e.target.value)}
          className="mt-4 w-full accent-[var(--color-brand)]"
        />
        <p className="mt-2 text-[13px] text-fg-muted">
          About {usd(cents * 30)} a month. Migz may spend a little more on strong days and less on slow ones, but it
          averages out to this.
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
