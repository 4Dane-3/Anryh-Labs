import "server-only";
import { DateTime } from "luxon";
import { pageAnalytics } from "@/lib/admin/page-analytics";
import { getRecentBatches, type Batch } from "@/lib/dashboard/batches";
import { fetchPageEvents } from "@/lib/dashboard/page-events";

export type BatchChoice = { id: string; label: string; running: boolean };

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** "Oct 28 – Nov 3 · $700 · running" */
function label(b: Batch, zone: string) {
  const d = (iso: string | null) => (iso ? DateTime.fromISO(iso, { zone }).toFormat("LLL d") : "?");
  return `${d(b.starts_on)} – ${d(b.ends_on)} · ${money(b.budget_cents)}${b.status === "active" ? " · running" : ""}`;
}

/**
 * One agent's page analytics for a campaign batch: the running one by default, or a past one by id. It
 * counts visits from the moment the batch started (not its first midnight, so a 5am launch isn't mixed with
 * the night before) to the end of its last day, or now while it runs. Agents with no batch yet get the last
 * 7 days. Covers partner-site pages too (they report to the same place). { ready: false } before the
 * page_events migration.
 */
export async function loadPageAnalytics(agent: { id: string; timezone: string }, batchId?: string | null) {
  const batches = (await getRecentBatches(agent.id, 8)).filter((b) => b.starts_on);
  const choices: BatchChoice[] = batches.map((b) => ({ id: b.id, label: label(b, agent.timezone), running: b.status === "active" }));
  const batch = batches.find((b) => b.id === batchId) ?? batches.find((b) => b.status === "active") ?? batches[0] ?? null;

  const now = DateTime.now().setZone(agent.timezone);
  const from = batch
    ? (batch.started_at ? DateTime.fromISO(batch.started_at).setZone(agent.timezone) : DateTime.fromISO(batch.starts_on!, { zone: agent.timezone }))
    : now.minus({ days: 6 }).startOf("day");
  const lastDay = batch?.ends_on ? DateTime.fromISO(batch.ends_on, { zone: agent.timezone }).endOf("day") : now;
  const to = batch?.ended_at ? DateTime.min(DateTime.fromISO(batch.ended_at).setZone(agent.timezone), lastDay) : DateTime.min(lastDay, now);
  const days = Math.max(1, Math.round(to.startOf("day").diff(from.startOf("day"), "days").days) + 1);

  const { data, error } = await fetchPageEvents(agent.id, from.toUTC().toISO()!, to.toUTC().toISO()!);
  if (error && !data) return { ready: false as const };
  return {
    ready: true as const,
    period: batch ? { batchId: batch.id, label: choices.find((c) => c.id === batch.id)!.label } : { batchId: null, label: "Last 7 days" },
    batches: choices,
    ...pageAnalytics(data ?? [], days, agent.timezone, to.toJSDate()),
  };
}
