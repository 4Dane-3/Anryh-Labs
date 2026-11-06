import Link from "next/link";
import { isRoofer } from "@/lib/verticals";
import { DateTime } from "luxon";
import { requireSetUpAgent } from "@/lib/auth";
import { integrations } from "@/lib/integrations";
import { getBalanceCents, getFundsAddedCents, getTransactions } from "@/lib/dashboard/queries";
import { getActiveBatch } from "@/lib/dashboard/batches";
import { stripeTestMode } from "@/lib/stripe";
import { usd } from "@/lib/dashboard/format";
import { AddFunds, BudgetControls } from "@/components/dashboard/FundsControls";
import { AutoTopUp } from "@/components/dashboard/AutoTopUp";
import { topUpDefaults } from "@/lib/auto-top-up";
import { getGuarantee } from "@/lib/dashboard/guarantee";
import { GuaranteeCard } from "@/components/dashboard/GuaranteeCard";
import { Badge, EmptyState, NotConnected, PageHeader, Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  ad_spend: "Ad spend",
  fee: "Fee",
  refund: "Refund",
  adjustment: "Adjustment",
  referral_credit: "Referral credit",
};

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ deposit?: string; auto?: string }> }) {
  const [agent, { deposit, auto }] = await Promise.all([requireSetUpAgent(), searchParams]);
  const [balance, transactions, batch, fundsAdded, guarantee] = await Promise.all([
    getBalanceCents(agent.id),
    getTransactions(agent.id),
    getActiveBatch(agent.id),
    getFundsAddedCents(agent.id),
    getGuarantee(agent).catch(() => null),
  ]);
  const defaults = topUpDefaults(agent.daily_budget_cents);
  const daysLeft = agent.daily_budget_cents > 0 ? Math.floor(balance / agent.daily_budget_cents) : null;

  return (
    <>
      <PageHeader
        title="Ad funds"
        description="Money you add here pays for your Meta ads. Migz AI spends it where it books the most calls, and pauses your ads before the balance runs out."
      />

      {!agent.onboarding_completed_at && (
        <p className="mb-6 rounded-lg border border-line bg-ink-raised px-4 py-3 text-[13px] text-fg-muted">
          New here? <Link href="/dashboard/start" className="font-medium text-brand hover:underline">Start here</Link> walks you through funds and your first campaign batch, step by step.
        </p>
      )}

      {deposit === "success" && (
        <p className="mb-6 rounded-lg border border-good/30 bg-good/10 px-4 py-3 text-[13px] text-fg">
          Payment received. Your balance updates as soon as Stripe confirms it, usually within a few seconds; refresh if it hasn&apos;t yet.
        </p>
      )}
      {deposit === "canceled" && (
        <p className="mb-6 rounded-lg border border-line bg-ink-raised px-4 py-3 text-[13px] text-fg-muted">No payment was made. You can add funds whenever you&apos;re ready.</p>
      )}
      {auto === "on" && (
        <p className="mb-6 rounded-lg border border-good/30 bg-good/10 px-4 py-3 text-[13px] text-fg">
          Card saved. Auto top-up turns on as soon as Stripe confirms it, usually within a few seconds; refresh if it hasn&apos;t yet.
        </p>
      )}
      {auto === "canceled" && (
        <p className="mb-6 rounded-lg border border-line bg-ink-raised px-4 py-3 text-[13px] text-fg-muted">No card was saved. Auto top-up is still off.</p>
      )}
      {integrations.stripe && stripeTestMode() && (
        <p className="mb-6 rounded-lg border border-brand/30 bg-brand/[0.06] px-4 py-3 text-[13px] text-fg-muted">
          Payments are in Stripe test mode: no real money moves. Pay with card 4242 4242 4242 4242, any future date and any CVC.
        </p>
      )}

      {!integrations.stripe && (
        <div className="mb-6">
          <NotConnected service="Stripe">You can set your budget now; adding funds works once payments are set up.</NotConnected>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <div className="border-b border-line px-6 py-6">
            <p className="text-[13px] text-fg-muted">Available balance</p>
            <p className="mt-2 text-5xl font-semibold tracking-tight">{usd(balance, { cents: true })}</p>
            <p className="mt-2 text-[13px] text-fg-muted">
              {agent.ads_paused
                ? "Your ads are paused."
                : agent.funds_used_up
                  ? `Your ad funds are used up. Add funds to run more ads${batch?.ends_on ? `; your current ads end on ${batch.ends_on}` : ""}.`
                : batch
                  ? `Free to use. This week's cycle has its ${usd(batch.budget_cents)} set aside; what it doesn't spend comes back here when it ends on ${batch.ends_on}. The next cycle starts from this balance, so keep at least ${usd(batch.budget_cents)} here to keep your campaign rolling.`
                  : daysLeft !== null
                    ? `Covers about ${daysLeft} day${daysLeft === 1 ? "" : "s"} of ads at ${usd(agent.daily_budget_cents)} a day.`
                    : null}
            </p>
          </div>
          <AddFunds addedBeforeCents={fundsAdded} />
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader title="Daily spend" description="How much your ads spend in a day during a batch." />
          <BudgetControls
            dailyBudgetCents={agent.daily_budget_cents}
            paused={agent.ads_paused}
            batchLabel={batch ? `$${(batch.budget_cents / 100).toFixed(0)} cycle (until ${batch.ends_on})` : null}
          />
        </Panel>
      </div>

      {integrations.stripe && (
        <div className="mt-3">
          <AutoTopUp
            state={{
              on: !!agent.auto_topup,
              card: agent.auto_topup_card ?? null,
              amountCents: agent.auto_topup_amount_cents ?? defaults.amountCents,
              belowCents: agent.auto_topup_below_cents ?? defaults.belowCents,
              error: agent.auto_topup_error ?? null,
              addedBeforeCents: fundsAdded,
              dailyCents: agent.daily_budget_cents,
            }}
          />
        </div>
      )}

      {guarantee && (
        <div className="mt-3">
          <GuaranteeCard
            roof={isRoofer(agent)}
            g={{
              status: guarantee.row.status === "running" ? guarantee.evaluation.status : guarantee.row.status,
              day: guarantee.evaluation.day,
              daysTotal: guarantee.evaluation.daysTotal,
              endsOn: guarantee.row.ends_on,
              target: guarantee.row.target,
              bookings: guarantee.row.status === "running" ? guarantee.bookings : (guarantee.row.bookings ?? guarantee.bookings),
              feeCents: guarantee.row.status === "running" ? guarantee.feeCents : (guarantee.row.fee_cents ?? guarantee.feeCents),
              conditions: guarantee.evaluation.conditions,
              onTrack: guarantee.evaluation.onTrack,
            }}
          />
        </div>
      )}

      <Panel className="mt-3">
        <PanelHeader title="History" description="Deposits, fees, and money set aside for (and returned from) your campaign batches." />
        {transactions.length ? (
          <ul className="divide-y divide-line">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.description ?? KIND_LABEL[t.kind]}</p>
                  <p className="text-[12px] text-fg-faint">
                    {DateTime.fromISO(t.created_at, { zone: agent.timezone }).toFormat("LLL d, yyyy")}
                  </p>
                </div>
                <Badge tone={t.status === "failed" ? "bad" : t.status === "pending" ? "accent" : "neutral"}>
                  {t.status === "completed" ? KIND_LABEL[t.kind] : t.status === "pending" ? "Pending" : "Failed"}
                </Badge>
                <span
                  className={cn(
                    "w-24 text-right text-sm font-medium tabular-nums",
                    t.amount_cents > 0 ? "text-good" : "text-fg",
                  )}
                >
                  {t.amount_cents > 0 ? "+" : "−"}
                  {usd(Math.abs(t.amount_cents), { cents: true })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No transactions yet">Deposits and ad spend will be listed here.</EmptyState>
        )}
      </Panel>
    </>
  );
}
