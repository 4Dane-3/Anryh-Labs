import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowRight } from "lucide-react";
import { isAnryhAdmin, requireAgent } from "@/lib/auth";
import { getMigzUpdate } from "@/lib/dashboard/status";
import { integrations, migzReadyFor } from "@/lib/integrations";
import {
  getAdActions,
  getBalanceCents,
  getProposedActions,
  getDailyMetrics,
  getUpcomingBookings,
} from "@/lib/dashboard/queries";
import { pct, usd } from "@/lib/dashboard/format";
import { StatTile } from "@/components/dashboard/StatTile";
import { BarChart } from "@/components/dashboard/BarChart";
import { Badge, EmptyState, NotConnected, PageHeader, Panel, PanelHeader } from "@/components/dashboard/ui";
import { MigzPanel } from "@/components/dashboard/MigzPanel";
import { BrainWidget } from "@/components/dashboard/brain/BrainWidget";
import { getBrainLive } from "@/lib/migz/brain";
import { closeEndedBatch, ensureBatchSetAside, getBatchProgress, getOpenBatch, getRecentBatches } from "@/lib/dashboard/batches";
import { BatchCard } from "@/components/dashboard/batch/BatchCard";
import { StartBatchButton } from "@/components/dashboard/batch/StartBatch";

export default async function OverviewPage() {
  const agent = await requireAgent();
  // A batch past its last day is closed (with its results) before the page reads it
  await closeEndedBatch(agent).catch(() => null);
  await ensureBatchSetAside(agent).catch(() => null);
  const [metrics, balance, upcoming, actions, proposals, brain, openBatch, pastBatches] = await Promise.all([
    getDailyMetrics(agent, 30),
    getBalanceCents(agent.id),
    getUpcomingBookings(agent.id, 5),
    getAdActions(agent.id, 6),
    getProposedActions(agent.id),
    getBrainLive(agent),
    getOpenBatch(agent.id),
    getRecentBatches(agent.id, 4),
  ]);
  const activeBatch = openBatch?.status === "active" ? openBatch : null;
  const [update, canReview] = await Promise.all([getMigzUpdate(agent), isAnryhAdmin()]);
  const batchProgress = activeBatch ? await getBatchProgress(agent, activeBatch) : null;
  const batchBlocked = !agent.onboarding_completed_at
    ? "Finish setting up first"
    : !migzReadyFor(agent)
      ? "Your ad account isn't linked yet"
      : activeBatch
        ? `Your batch runs until ${activeBatch.ends_on}`
        : null;
  const recentlyRan =
    !!agent.migz_last_operator_at && DateTime.now().diff(DateTime.fromISO(agent.migz_last_operator_at), "minutes").minutes < 10;

  const spend = metrics.reduce((s, d) => s + d.spend_cents, 0);
  const leads = metrics.reduce((s, d) => s + d.leads, 0);
  const clicks = metrics.reduce((s, d) => s + d.clicks, 0);
  const impressions = metrics.reduce((s, d) => s + d.impressions, 0);
  const hasMetrics = spend > 0 || impressions > 0;
  const daysLeft =
    agent.daily_budget_cents > 0 ? Math.floor(balance / agent.daily_budget_cents) : null;

  const firstName = agent.full_name.split(" ")[0];
  const hour = DateTime.now().setZone(agent.timezone).hour;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description="How your ads performed over the last 30 days, and what's coming up. Migz AI runs your ads and tunes them as results come in."
        action={<StartBatchButton balanceCents={balance} disabledReason={batchBlocked} autoRun={agent.migz_mode === "auto"} />}
      />

      {!agent.onboarding_completed_at && (
        <Link
          href="/dashboard/start"
          className="mb-6 flex items-center gap-4 rounded-xl border border-brand/40 bg-brand/[0.08] px-5 py-4 transition-colors hover:bg-brand/[0.12]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-fg">Finish setting up to start your first campaign</span>
            <span className="block text-[13px] text-fg-muted">Profile, booking page, funds, plan and creatives. About 10 minutes.</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-fg">
            Start here <ArrowRight className="size-3.5" />
          </span>
        </Link>
      )}

      {!integrations.meta && (
        <div className="mb-6">
          <NotConnected service="Meta">
            {hasMetrics
              ? "The numbers below are sample data so you can see how this page works."
              : "Ad results will appear here once your ad account is linked."}
          </NotConnected>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          index={0}
          emphasis
          label="Ad balance"
          value={balance}
          format="usd"
          hint={
            agent.ads_paused
              ? "Ads are paused"
              : activeBatch
                ? `Plus ${usd(activeBatch.budget_cents)} set aside for your running batch`
                : daysLeft !== null
                  ? `About ${daysLeft} day${daysLeft === 1 ? "" : "s"} at ${usd(agent.daily_budget_cents)}/day`
                  : undefined
          }
        />
        <StatTile index={1} label="Spent · 30 days" value={spend} format="usd" hint={`${usd(Math.round(spend / 30))} a day on average`} />
        <StatTile
          index={2}
          label="Calls booked from ads"
          value={leads}
          hint={clicks ? `${clicks.toLocaleString()} clicks · ${pct(clicks / Math.max(impressions, 1))} click rate` : undefined}
        />
        <StatTile
          index={3}
          label="Cost per booked call"
          value={leads ? Math.round(spend / leads) : null}
          format="usd"
          hint={leads ? "Ad spend ÷ calls booked" : "Needs at least one booked call"}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Spend per day" description={`${usd(spend)} over 30 days`} />
          <div className="px-4 pb-3 pt-4">
            {hasMetrics ? (
              <BarChart
                label="Ad spend per day, last 30 days"
                format="usd"
                data={metrics.map((d) => ({ date: d.date, value: d.spend_cents }))}
              />
            ) : (
              <EmptyState title="No spend yet">Daily spend shows here once ads are running.</EmptyState>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Calls booked per day" description={`${leads} from ads over 30 days`} />
          <div className="px-4 pb-3 pt-4">
            {hasMetrics ? (
              <BarChart
                label="Calls booked from ads per day, last 30 days"
                format="number"
                data={metrics.map((d) => ({ date: d.date, value: d.leads }))}
              />
            ) : (
              <EmptyState title="No booked calls yet">Bookings from your ads show here.</EmptyState>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <MigzPanel
            connected={migzReadyFor(agent)}
            mode={agent.migz_mode}
            recentlyRan={recentlyRan}
            proposals={proposals}
            actions={actions}
            update={update}
            canReview={canReview}
          />
        </Panel>
        <Panel className="lg:col-span-2">
          <BatchCard
            active={activeBatch}
            planned={openBatch?.status === "planned" ? openBatch : null}
            progress={batchProgress}
            past={pastBatches}
            timezone={agent.timezone}
          />
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader
            title="Upcoming calls"
            action={
              <Link
                href="/dashboard/calendar"
                className="inline-flex items-center gap-1 text-[13px] text-fg-muted transition-colors hover:text-fg"
              >
                Calendar <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {upcoming.length ? (
            <ul className="divide-y divide-line">
              {upcoming.map((b) => {
                const start = DateTime.fromISO(b.starts_at, { zone: agent.timezone });
                return (
                  <li key={b.id}>
                    <Link
                      href={`/dashboard/clients?id=${b.id}`}
                      className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="w-14 shrink-0 text-center">
                        <div className="text-[11px] uppercase tracking-wide text-fg-faint">{start.toFormat("ccc")}</div>
                        <div className="text-lg font-semibold leading-tight">{start.toFormat("d")}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{b.name}</p>
                        <p className="text-[13px] text-fg-muted">{start.toFormat("h:mm a")}</p>
                      </div>
                      {b.intake_completed ? (
                        <Badge tone="good">Prep answered</Badge>
                      ) : b.answers ? (
                        <Badge tone="accent">Prep started</Badge>
                      ) : (
                        <Badge>No prep yet</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No calls on the books">
              New bookings from your page show up here, and in Slack.
            </EmptyState>
          )}
        </Panel>

        {migzReadyFor(agent) && (
          <div className="lg:col-span-2">
            <BrainWidget initial={brain} />
          </div>
        )}
      </div>
    </>
  );
}
