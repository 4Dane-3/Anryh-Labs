import { DateTime } from "luxon";
import { requireAgent } from "@/lib/auth";
import { integrations } from "@/lib/integrations";
import { getBalanceCents, getTransactions } from "@/lib/dashboard/queries";
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

export default async function FundsPage() {
  const agent = await requireAgent();
  const [balance, transactions] = await Promise.all([
    getBalanceCents(agent.id),
    getTransactions(agent.id),
  ]);
  const daysLeft = agent.daily_budget_cents > 0 ? Math.floor(balance / agent.daily_budget_cents) : null;

  return (
    <>
      <PageHeader
        title="Ad funds"
        description="Money you add here pays for your Meta ads. Migz AI spends it where it books the most calls, and pauses your ads before the balance runs out."
      />

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
          <PanelHeader title="Daily budget" description="The most your ads can spend in a day." />
          <BudgetControls dailyBudgetCents={agent.daily_budget_cents} paused={agent.ads_paused} />
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
