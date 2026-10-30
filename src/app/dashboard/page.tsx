import Link from "next/link";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier } from "@/lib/ad-options";
import { DateTime } from "luxon";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { isAnryhAdmin, requireAgent } from "@/lib/auth";
import { getMigzUpdate } from "@/lib/dashboard/status";
import { integrations, migzReadyFor } from "@/lib/integrations";
import {
  getAdActions,
  getBalanceCents,
  getProposedActions,
  getDailyMetrics,
  getUpcomingBookings,
  getLiveAdCount,
} from "@/lib/dashboard/queries";
import { pct, usd } from "@/lib/dashboard/format";
import { MetricRow } from "@/components/dashboard/MetricRow";
import { BarChart } from "@/components/dashboard/BarChart";
import { Badge, EmptyState, NotConnected, Panel, PanelHeader } from "@/components/dashboard/ui";
import { MigzPanel } from "@/components/dashboard/MigzPanel";
import { LiveBrainCard } from "@/components/dashboard/brain/BrainCard";
import { getBrainLive } from "@/lib/migz/brain";
import { closeEndedBatch, ensureBatchSetAside, getBatchProgress, getOpenBatch, getRecentBatches } from "@/lib/dashboard/batches";
import { BatchCard } from "@/components/dashboard/batch/BatchCard";
import { StartBatchButton } from "@/components/dashboard/batch/StartBatch";

export default async function OverviewPage() {
  const agent = await requireAgent();
  // A batch past its last day is closed (with its results) before the page reads it
  await closeEndedBatch(agent).catch(() => null);
  await ensureBatchSetAside(agent).catch(() => null);
  const [metrics, balance, upcoming, actions, proposals, brain, openBatch, pastBatches, liveAds] = await Promise.all([
    getDailyMetrics(agent, 30),
    getBalanceCents(agent.id),
    getUpcomingBookings(agent.id, 5),
    getAdActions(agent.id, 6),
    getProposedActions(agent.id),
    getBrainLive(agent),
    getOpenBatch(agent.id),
    getRecentBatches(agent.id, 4),
    getLiveAdCount(agent.id),
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

  const costPerCall = leads ? Math.round(spend / leads) : null;
  // Where the money stands: a running batch has its own budget set aside; otherwise how long the balance lasts
  const money = activeBatch
    ? ` Your running batch has ${usd(activeBatch.budget_cents)} set aside.`
    : daysLeft === 0
      ? " Your ad balance is empty: add funds so your ads keep running."
      : daysLeft !== null
        ? ` Your balance covers about ${daysLeft} more day${daysLeft === 1 ? "" : "s"}.`
        : "";
  // The campaign in one or two plain sentences, from the same numbers as the row below
  const summary = agent.ads_paused
    ? "Your ads are paused, so nothing is spending right now. Migz AI picks up again when you turn them back on."
    : !hasMetrics
      ? "Your ads haven't spent anything yet. Once they run, this shows what you spent and how many calls they booked."
      : `Migz AI has ${liveAds} ad${liveAds === 1 ? "" : "s"} running. Over the last 30 days you spent ${usd(spend)} and booked ${leads} call${leads === 1 ? "" : "s"} from your ads${costPerCall ? `, about ${usd(costPerCall)} each` : ""}.${money}`;

  return (
    <>
      {!agent.onboarding_completed_at && (
        <Link
          href="/dashboard/start"
          className="mb-6 flex items-center gap-4 rounded-2xl border border-brand/40 bg-brand/[0.08] px-5 py-4 backdrop-blur-xl transition-colors hover:bg-brand/[0.12]"
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

      <section className="mb-8 grid gap-8 lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col justify-end lg:pb-1">
          <p className="text-sm text-fg-muted">
            Your Meta campaign · {liveAds} ad{liveAds === 1 ? "" : "s"} running
          </p>
          <h1 className="mt-3 text-5xl font-normal leading-[0.98] tracking-[-0.045em] text-fg sm:text-7xl">
            {greeting},
            <br />
            {firstName}.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-fg-muted">{summary}</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <StartBatchButton balanceCents={balance} disabledReason={batchBlocked} autoRun={agent.migz_mode === "auto"} intentLevel={isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT} videoTier={isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER} />
            <Link href="/dashboard/brain" className="inline-flex items-center gap-1 text-sm text-fg hover:underline hover:underline-offset-4">
              See what Migz AI is doing <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>
        <div id="migz-brain" className="lg:self-start">
          {migzReadyFor(agent) ? (
            <LiveBrainCard initial={brain} />
          ) : (
            <div className="rounded-[26px] border border-white/20 bg-[rgb(120_165_220/0.16)] px-5 py-8 text-[14px] text-fg-muted backdrop-blur-2xl">
              <p className="font-medium text-fg">Migz AI Brain</p>
              <p className="mt-1">Once your ad account is linked, you&apos;ll see Migz AI reading your numbers and changing your ads here, live.</p>
            </div>
          )}
        </div>
      </section>

      <div className="mb-8">
        <MetricRow
          items={[
            {
              label: "Ad balance",
              value: usd(balance),
              hint: agent.ads_paused
                ? "Ads are paused"
                : activeBatch
                  ? `Plus ${usd(activeBatch.budget_cents)} set aside for your running batch`
                  : daysLeft !== null
                    ? `About ${daysLeft} day${daysLeft === 1 ? "" : "s"} at ${usd(agent.daily_budget_cents)}/day`
                    : undefined,
            },
            { label: "Spent · 30 days", value: usd(spend), hint: `${usd(Math.round(spend / 30))} a day on average` },
            {
              label: "Calls booked from ads",
              value: leads.toLocaleString(),
              hint: clicks ? `${clicks.toLocaleString()} clicks · ${pct(clicks / Math.max(impressions, 1))} click rate` : undefined,
            },
            {
              label: "Cost per booked call",
              value: costPerCall ? usd(costPerCall) : null,
              hint: leads ? "Ad spend ÷ calls booked" : "Needs at least one booked call",
            },
          ]}
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
            balanceCents={balance}
          />
        </Panel>
      </div>

      <div className="mt-3">
        <Panel>
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

      </div>
    </>
  );
}
