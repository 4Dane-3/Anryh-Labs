import Link from "next/link";
import { DateTime } from "luxon";
import { requireAgent } from "@/lib/auth";
import { integrations } from "@/lib/integrations";
import { getBalanceCents, getTransactions } from "@/lib/dashboard/queries";
import { getActiveBatch } from "@/lib/dashboard/batches";
import { stripeTestMode } from "@/lib/stripe";
import { usd } from "@/lib/dashboard/format";
import { AddFunds, BudgetControls } from "@/components/dashboard/FundsControls";
import { Badge, EmptyState, NotConnected, PageHeader, Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  ad_spend: "Ad spend",
  fee: "Fee",
  refund: "Refund",
  adjustment: "Adjustment",
};

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ deposit?: string }> }) {
  const [agent, { deposit }] = await Promise.all([requireAgent(), searchParams]);
  const [balance, transactions, batch] = await Promise.all([
    getBalanceCents(agent.id),
    getTransactions(agent.id),
    getActiveBatch(agent.id),
  ]);
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
                : daysLeft !== null
                  ? `Covers about ${daysLeft} day${daysLeft === 1 ? "" : "s"} of ads at ${usd(agent.daily_budget_cents)} a day.`
                  : null}
            </p>
          </div>
          <AddFunds />
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader title="Daily spend" description="How much your ads spend in a day during a batch." />
          <BudgetControls
            dailyBudgetCents={agent.daily_budget_cents}
            paused={agent.ads_paused}
            batchLabel={batch ? `$${(batch.budget_cents / 100).toFixed(0)} batch (until ${batch.ends_on})` : null}
          />
        </Panel>
      </div>

      <Panel className="mt-3">
        <PanelHeader title="History" description="Deposits, and ad spend billed by Meta." />
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
