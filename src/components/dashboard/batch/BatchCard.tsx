import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowRight } from "lucide-react";
import type { Batch } from "@/lib/dashboard/batches";
import { listCampaignTopics, type CampaignSlot } from "@/lib/batch";
import { usd } from "@/lib/dashboard/format";
import { EmptyState, PanelHeader } from "@/components/dashboard/ui";
import { KeepGoing } from "@/components/dashboard/batch/KeepGoing";
import { depositFor } from "@/lib/campaign";

const TITLES: Record<string, string> = { focused: "Focused", balanced: "Balanced", spread: "Spread", explore: "Main + exploration", sprint: "One-week sprint" };
const whole = (cents: number) => usd(cents, { cents: cents % 100 !== 0 && cents < 100_00 });
const topicsOf = (b: Batch) => b.campaigns.map((t) => (t || null) as CampaignSlot);
const range = (b: Batch, zone: string) =>
  b.starts_on && b.ends_on
    ? `${DateTime.fromISO(b.starts_on, { zone }).toFormat("LLL d")} – ${DateTime.fromISO(b.ends_on, { zone }).toFormat("LLL d")}`
    : `${b.days} days`;

/** What Keep going will do next, and whether the balance wouldn't cover it. */
function keepNote(batch: Batch, balanceCents: number, zone: string, unspentCents = 0): { note: string; warn: boolean } {
  const need = batch.budget_cents;
  if (batch.status === "ended") {
    return { note: batch.renew_blocked ?? "Your next batch starts within the hour.", warn: true };
  }
  if (!batch.renew) return { note: `When this batch ends, the same ${whole(need)} batch starts again from your balance. Turn it on to keep the ads running without a gap. It never charges a card.`, warn: false };
  const next = batch.ends_on ? DateTime.fromISO(batch.ends_on, { zone }).plus({ days: 1 }).toFormat("LLL d") : "when it ends";
  // The unspent part of this batch comes back before the next one starts
  const short = need - (balanceCents + unspentCents);
  return short > 0
    ? { note: `The next ${whole(need)} batch starts ${next} from your balance, which is ${whole(balanceCents)} now. Add about ${whole(depositFor(short))} in funds before then, or it waits for them.`, warn: true }
    : { note: `The next ${whole(need)} batch starts ${next}, paid from your balance (${whole(balanceCents)} free now). Turn this off and it just ends.`, warn: false };
}

/** The running batch (spend against its budget, day, booked calls), or what's next, plus the last few batches. */
export function BatchCard({
  active,
  planned,
  progress,
  past,
  timezone,
  balanceCents,
}: {
  active: Batch | null;
  planned: Batch | null;
  progress: { spentCents: number; bookedCalls: number; day: number; daysLeft: number | null } | null;
  past: Batch[];
  timezone: string;
  /** The free ad balance, which Keep going draws the next batch from. */
  balanceCents: number;
}) {
  const ended = past.filter((b) => b.status === "ended").slice(0, 3);
  // Keep going, on the running batch or waiting on funds after one that just ended
  const waiting = !active ? ended.find((b) => b.renew) ?? null : null;
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={active ? "Active campaign batch" : "Campaign batches"}
        description={active ? `${TITLES[active.option]} · ${range(active, timezone)}` : "Each batch is a block of ad money Migz plans and runs."}
      />
      {active && progress ? (
        <div className="space-y-4 px-5 py-4">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-3xl font-semibold tracking-tight tabular-nums">{whole(active.budget_cents)}</p>
              <p className="text-[13px] text-fg-muted">
                Day {Math.min(progress.day, active.days)} of {active.days}
                {progress.daysLeft !== null && ` · ${progress.daysLeft} left`}
              </p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (progress.spentCents / active.budget_cents) * 100)}%` }} />
            </div>
            <p className="mt-2 text-[13px] text-fg-muted">
              {whole(progress.spentCents)} spent of {whole(active.budget_cents)} · {whole(active.daily_cents)}/day
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <dt className="text-fg-faint">Booked calls</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{progress.bookedCalls}</dd>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-3 py-2">
              <dt className="text-fg-faint">Cost per call</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{progress.bookedCalls ? whole(Math.round(progress.spentCents / progress.bookedCalls)) : "—"}</dd>
            </div>
          </dl>
          <div>
            <p className="text-[12px] text-fg-faint">{active.campaigns.length} campaign{active.campaigns.length === 1 ? "" : "s"}</p>
            <p className="mt-0.5 text-[13px] text-fg-muted">{listCampaignTopics(topicsOf(active))}</p>
          </div>
          {active.reason && <p className="border-t border-line pt-3 text-[12px] text-fg-faint">Why this plan: {active.reason}</p>}
          <KeepGoing on={active.renew} {...keepNote(active, balanceCents, timezone, Math.max(0, active.budget_cents - progress.spentCents))} />
        </div>
      ) : planned ? (
        <div className="px-5 py-4 text-[13px] text-fg-muted">
          <p>
            Your first batch, {whole(planned.budget_cents)} over {planned.days} days ({listCampaignTopics(topicsOf(planned))}), starts when you finish setup.
          </p>
          <Link href="/dashboard/start" className="mt-3 inline-flex items-center gap-1 font-medium text-brand hover:underline">
            Finish setup <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <EmptyState title="No batch running">Start a campaign batch and Migz plans how to spend it for the most booked calls.</EmptyState>
      )}

      {waiting && (
        <div className="px-5 pb-4">
          <KeepGoing on {...keepNote(waiting, balanceCents, timezone)} />
        </div>
      )}

      {ended.length > 0 && (
        <div className="mt-auto border-t border-line px-5 py-3">
          <p className="mb-1.5 text-[12px] text-fg-faint">Past batches</p>
          <ul className="space-y-1">
            {ended.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-fg-muted">
                  {whole(b.budget_cents)} · {range(b, timezone)}
                </span>
                <span className="shrink-0 tabular-nums text-fg">
                  {b.result ? `${b.result.booked_calls} call${b.result.booked_calls === 1 ? "" : "s"}${b.result.booked_calls ? ` · ${whole(Math.round(b.result.spent_cents / b.result.booked_calls))} each` : ""}` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
