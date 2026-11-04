"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, RefreshCw } from "lucide-react";
import { removeAutoTopUpCard, saveAutoTopUp, setAutoTopUp, startAutoTopUpSetup } from "@/app/dashboard/actions";
import { FUNDS_STEP_CENTS } from "@/lib/campaign-plan";
import { MAX_BELOW_CENTS, MIN_BELOW_CENTS, topUpConsent } from "@/lib/auto-top-up";
import { adSpendCents, MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS } from "@/lib/campaign";
import { usd } from "@/lib/dashboard/format";
import { Button, Label, Panel, PanelHeader, Switch, inputClass } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// Auto top-up on the Ad funds page: the amount and the level, a saved card (Stripe's own page saves it, nothing
// is charged then), and on/off. The authorization the agent ticks is the same text Stripe shows when they save.

export type AutoTopUpState = {
  on: boolean;
  card: string | null;
  amountCents: number;
  belowCents: number;
  error: string | null;
  addedBeforeCents: number;
  dailyCents: number;
};

const AMOUNTS = Array.from({ length: MAX_DEPOSIT_CENTS / FUNDS_STEP_CENTS }, (_, i) => (i + 1) * FUNDS_STEP_CENTS).filter((c) => c >= MIN_DEPOSIT_CENTS && c <= 500_000);
const LEVELS = [10_000, 15_000, 20_000, 25_000, 35_000, 50_000, 70_000, 100_000, 150_000, 200_000].filter((c) => c >= MIN_BELOW_CENTS && c <= MAX_BELOW_CENTS);

export function AutoTopUp({ state }: { state: AutoTopUpState }) {
  const router = useRouter();
  const [amount, setAmount] = useState(state.amountCents);
  const [below, setBelow] = useState(state.belowCents);
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<{ good: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const hasCard = !!state.card;
  const changed = amount !== state.amountCents || below !== state.belowCents;
  const forAds = adSpendCents(amount, state.addedBeforeCents);
  const days = state.dailyCents > 0 ? Math.floor(forAds / state.dailyCents) : null;
  const levels = [...new Set([...LEVELS, below])].sort((a, b) => a - b);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      setMessage(null);
      const res = await fn();
      setMessage(res.ok ? { good: true, text: done } : { good: false, text: res.error });
      if (res.ok) router.refresh();
    });

  const saveCard = () =>
    start(async () => {
      setMessage(null);
      const res = await startAutoTopUpSetup({ amountCents: amount, belowCents: below, agreed });
      if (res.ok) window.location.href = res.url;
      else setMessage({ good: false, text: res.error });
    });

  return (
    <Panel>
      <PanelHeader
        title="Auto top-up"
        description="Keeps your campaign rolling without you watching the balance: when it runs low, your saved card is charged the amount you choose, like Meta's own billing."
        action={hasCard ? <Switch checked={state.on && !state.error} onChange={(v) => run(() => setAutoTopUp(v), v ? "Auto top-up is on." : "Auto top-up is off. Your card stays saved.")} label="Auto top-up" disabled={pending} /> : undefined}
      />
      <div className="space-y-4 px-5 py-4">
        {state.error && (
          <p className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-[13px] text-fg">
            Your last top-up didn&apos;t go through: {state.error} Auto top-up is paused. Save a card again to turn it back on.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="topup-below">When my balance drops below</Label>
            <select id="topup-below" className={inputClass} value={below} onChange={(e) => setBelow(Number(e.target.value))}>
              {levels.map((c) => (
                <option key={c} value={c}>
                  {usd(c, { cents: false })}
                  {state.dailyCents > 0 && c === state.dailyCents * 7 ? " (a week of ads)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="topup-amount">Add</Label>
            <select id="topup-amount" className={inputClass} value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
              {AMOUNTS.map((c) => (
                <option key={c} value={c}>
                  {usd(c, { cents: false })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[12px] text-fg-muted">
          Each top-up adds {usd(forAds, { cents: false })} to your ads after the Anryh Labs fee{days !== null ? `, about ${days} day${days === 1 ? "" : "s"} at ${usd(state.dailyCents, { cents: false })}/day` : ""}. At most one charge every 20 hours; you get a Slack note each
          time.
        </p>

        {hasCard ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px] text-fg">
              <CreditCard className="size-4 text-fg-faint" /> {state.card}
            </span>
            <Button size="sm" variant="primary" onClick={() => run(() => saveAutoTopUp({ amountCents: amount, belowCents: below }), "Saved.")} disabled={pending || !changed}>
              Save changes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(removeAutoTopUpCard, "Card removed. Auto top-up is off.")} disabled={pending}>
              Remove card
            </Button>
            {state.error && (
              <Button size="sm" onClick={saveCard} disabled={pending || !agreed}>
                <RefreshCw /> Save a new card
              </Button>
            )}
          </div>
        ) : null}

        {(!hasCard || state.error) && (
          <>
            <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-fg-muted">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>{topUpConsent(amount, below)}</span>
            </label>
            {!hasCard && (
              <Button variant="primary" onClick={saveCard} disabled={pending || !agreed}>
                {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
                Save a card and turn on
              </Button>
            )}
            <p className="text-[12px] text-fg-faint">Your card is saved by Stripe on the next page. Nothing is charged until your balance drops below the level you chose.</p>
          </>
        )}
        {message && <p className={cn("text-[13px]", message.good ? "text-good" : "text-bad")}>{message.text}</p>}
      </div>
    </Panel>
  );
}
