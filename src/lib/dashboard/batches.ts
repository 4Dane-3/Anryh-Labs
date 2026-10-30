import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { isTopic, type TopicKey } from "@/lib/migz/topics";
import type { BatchHistory, BatchOptionKey } from "@/lib/batch";
import type { CampaignPlan } from "@/lib/campaign-plan";
import { notifyBatchEnded } from "@/lib/migz/notify";
import { syncAgent } from "@/lib/migz/sync";
import { adFunnel, funnelVerdict } from "@/lib/migz/funnel";
import type { EventRow } from "@/lib/admin/page-analytics";
import { fetchPageEvents } from "@/lib/dashboard/page-events";

export type Batch = {
  id: string;
  status: "planned" | "active" | "ended" | "canceled";
  budget_cents: number;
  option: BatchOptionKey;
  campaigns: string[];
  days: number;
  daily_cents: number;
  recommended_option: string | null;
  reason: string | null;
  starts_on: string | null;
  ends_on: string | null;
  applied_at: string | null;
  result: { spent_cents: number; booked_calls: number } | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  /** Days at the start that only collect results (the sprint reads 3; a renewal continues, so 0). */
  collect_days: number;
  /** Keep going: starts the same plan again when it ends, from the free balance. */
  renew: boolean;
  /** Why the last attempt to renew didn't happen (balance too low, ads paused...). */
  renew_blocked: string | null;
};

export const BATCH_COLS = "id, status, budget_cents, option, campaigns, days, daily_cents, recommended_option, reason, starts_on, ends_on, applied_at, result, created_at, started_at, ended_at, collect_days, renew, renew_blocked";
const COLS = BATCH_COLS;

/** What Migz planned for a batch when it started (campaign_batches.plan). Null before its migration. */
export async function getBatchPlan(batchId: string): Promise<CampaignPlan | null> {
  const { data, error } = await supabaseAdmin.from("campaign_batches").select("plan").eq("id", batchId).maybeSingle();
  return error ? null : ((data?.plan as CampaignPlan | null) ?? null);
}

/** The batch that's planned or running, if any. Null before the batches migration too. */
export async function getOpenBatch(agentId: string): Promise<Batch | null> {
  const { data } = await supabaseAdmin.from("campaign_batches").select(COLS).eq("agent_id", agentId).in("status", ["planned", "active"]).maybeSingle();
  return (data as Batch | null) ?? null;
}

export async function getActiveBatch(agentId: string): Promise<Batch | null> {
  const open = await getOpenBatch(agentId);
  return open?.status === "active" ? open : null;
}

export async function getRecentBatches(agentId: string, limit = 6): Promise<Batch[]> {
  const { data } = await supabaseAdmin.from("campaign_batches").select(COLS).eq("agent_id", agentId).neq("status", "planned").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as Batch[];
}

/** The topic each of the agent's Meta ads served: its campaign's topic, else the creative's. */
async function adTopics(agentId: string) {
  const { data } = await supabaseAdmin
    .from("ads")
    .select("meta_ad_id, ad_sets(ad_campaigns(topic)), creatives(script)")
    .eq("agent_id", agentId);
  const map = new Map<string, TopicKey | null>();
  for (const a of data ?? []) {
    const campaignTopic = (a.ad_sets as { ad_campaigns?: { topic?: string | null } | null } | null)?.ad_campaigns?.topic;
    const scriptTopic = (a.creatives as { script?: { topic?: string } | null } | null)?.script?.topic;
    const topic = isTopic(campaignTopic) ? campaignTopic : isTopic(scriptTopic) ? scriptTopic : null;
    map.set(a.meta_ad_id, topic);
  }
  return map;
}

/** Spend and booked calls (from our own bookings, attributed per ad), optionally between two dates. */
async function results(agent: Agent, from?: string | null, to?: string | null) {
  let insights = supabaseAdmin.from("ad_insights_daily").select("meta_ad_id, spend_cents").eq("agent_id", agent.id);
  if (from) insights = insights.gte("date", from);
  if (to) insights = insights.lte("date", to);
  let bookings = supabaseAdmin.from("bookings").select("attribution, created_at").eq("agent_id", agent.id).eq("status", "confirmed");
  if (from) bookings = bookings.gte("created_at", DateTime.fromISO(from, { zone: agent.timezone }).toUTC().toISO()!);
  if (to) bookings = bookings.lt("created_at", DateTime.fromISO(to, { zone: agent.timezone }).plus({ days: 1 }).toUTC().toISO()!);
  const [{ data: rows }, { data: booked }, topics] = await Promise.all([insights, bookings, adTopics(agent.id)]);

  const byTopic: BatchHistory["byTopic"] = {};
  const bump = (adId: string, spend: number, calls: number) => {
    const t = topics.get(adId);
    if (!t) return;
    const cur = byTopic[t] ?? { spentCents: 0, bookedCalls: 0 };
    cur.spentCents += spend;
    cur.bookedCalls += calls;
    byTopic[t] = cur;
  };
  let spentCents = 0;
  for (const r of rows ?? []) {
    spentCents += r.spend_cents;
    bump(r.meta_ad_id, r.spend_cents, 0);
  }
  let bookedCalls = 0;
  for (const b of booked ?? []) {
    const adId = (b.attribution as Record<string, string> | null)?.utm_content;
    if (!adId || !topics.has(adId)) continue; // only calls our ads brought in
    bookedCalls++;
    bump(adId, 0, 1);
  }
  return { spentCents, bookedCalls, byTopic };
}

const PAGE_DAYS = 30;

/**
 * The booking page over the last 30 days (from results_from when that's later, since earlier clicks
 * aren't comparable): where the ads' visitors stopped and what that says about the fix.
 */
async function pageHistory(agent: Agent): Promise<BatchHistory["page"]> {
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  let from = today.minus({ days: PAGE_DAYS - 1 }).toISODate()!;
  if (agent.results_from && agent.results_from > from) from = agent.results_from;
  const [events, clicks] = await Promise.all([
    fetchPageEvents(agent.id, DateTime.fromISO(from, { zone: agent.timezone }).toUTC().toISO()!),
    supabaseAdmin.from("ad_insights_daily").select("link_clicks").eq("agent_id", agent.id).gte("date", from),
  ]);
  if (events.error) return null;
  const funnel = adFunnel((events.data ?? []) as EventRow[], PAGE_DAYS, agent.timezone);
  const linkClicks = clicks.error ? null : (clicks.data ?? []).reduce((n, r) => n + (r.link_clicks ?? 0), 0);
  return { funnel, verdict: funnelVerdict(funnel, linkClicks) };
}

/** Everything this agent's ads have done so far. Never another agent's data. */
export async function getBatchHistory(agent: Agent): Promise<BatchHistory> {
  const [r, { count }, page] = await Promise.all([
    results(agent),
    supabaseAdmin.from("campaign_batches").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("status", "ended"),
    pageHistory(agent),
  ]);
  return { ...r, batches: count ?? 0, page };
}

/** How a batch is going: spend and booked calls since it started, and days left. */
export async function getBatchProgress(agent: Agent, batch: Batch) {
  if (!batch.starts_on) return { spentCents: 0, bookedCalls: 0, daysLeft: batch.days, day: 0 };
  const r = await results(agent, batch.starts_on, batch.ends_on);
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const start = DateTime.fromISO(batch.starts_on, { zone: agent.timezone });
  const end = batch.ends_on ? DateTime.fromISO(batch.ends_on, { zone: agent.timezone }) : null;
  return {
    spentCents: r.spentCents,
    bookedCalls: r.bookedCalls,
    day: Math.max(1, Math.floor(today.diff(start, "days").days) + 1),
    daysLeft: end ? Math.max(0, Math.round(end.diff(today, "days").days) + 1) : null,
  };
}

// ---------- The batch's money ----------
// Starting a batch sets its whole budget aside from the balance (one wallet line), so the balance shows
// what's actually free. When it ends, whatever it didn't spend comes back (another line). Daily Meta spend
// isn't taken from the balance on top of that; it's tracked against the batch instead.

const setAsideId = (batchId: string) => `batch:${batchId}`;
const returnId = (batchId: string) => `batch:${batchId}:return`;
const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** Sets the batch's budget aside from the balance, once. Safe to call repeatedly. */
export async function setAsideBatch(agent: Agent, batch: Batch) {
  if (batch.status !== "active" || !batch.starts_on) return false;
  const { data: existing } = await supabaseAdmin.from("wallet_transactions").select("id").eq("external_id", setAsideId(batch.id)).maybeSingle();
  if (existing) return false;
  // Batches started before set-asides existed may already have had daily spend taken; count it
  const { data: daily } = await supabaseAdmin
    .from("wallet_transactions")
    .select("amount_cents, external_id")
    .eq("agent_id", agent.id)
    .eq("kind", "ad_spend")
    .like("external_id", `meta_spend:${agent.id}:%`);
  const already = (daily ?? [])
    .filter((r) => {
      const date = String(r.external_id).split(":").pop()!;
      return date >= batch.starts_on! && (!batch.ends_on || date <= batch.ends_on);
    })
    .reduce((sum, r) => sum - r.amount_cents, 0);
  const range = batch.ends_on
    ? ` (${DateTime.fromISO(batch.starts_on).toFormat("LLL d")} – ${DateTime.fromISO(batch.ends_on).toFormat("LLL d")})`
    : "";
  const { error } = await supabaseAdmin.from("wallet_transactions").insert({
    agent_id: agent.id,
    kind: "adjustment",
    amount_cents: -Math.max(0, batch.budget_cents - already),
    status: "completed",
    description: `Set aside for your ${money(batch.budget_cents)} campaign batch${range}`,
    external_id: setAsideId(batch.id),
  });
  if (error && error.code !== "23505") throw new Error(`Couldn't set the batch's money aside: ${error.message}`);
  return !error;
}

/** Makes sure the running batch's money is set aside (for batches started before this existed). */
export async function ensureBatchSetAside(agent: Agent) {
  const batch = await getActiveBatch(agent.id);
  return batch ? setAsideBatch(agent, batch) : false;
}

/** When a batch ends, what it didn't spend goes back to the balance (only if its money was set aside). */
async function returnUnspent(agent: Agent, batch: Batch, spentCents: number) {
  const { data: setAside } = await supabaseAdmin.from("wallet_transactions").select("id").eq("external_id", setAsideId(batch.id)).maybeSingle();
  if (!setAside) return;
  const back = batch.budget_cents - spentCents;
  if (back === 0) return;
  const { error } = await supabaseAdmin.from("wallet_transactions").insert({
    agent_id: agent.id,
    kind: back > 0 ? "refund" : "adjustment",
    amount_cents: back,
    status: "completed",
    description: back > 0 ? `Unspent from your ${money(batch.budget_cents)} batch, back in your balance` : `Meta spent ${money(-back)} over your ${money(batch.budget_cents)} batch`,
    external_id: returnId(batch.id),
  });
  if (error && error.code !== "23505") console.error("returning the batch's unspent money failed", error);
}

/** If Meta can't be read for this long after a batch's last day, it closes on the spend it has. */
const CLOSE_WITHOUT_SYNC_DAYS = 2;

/** Closes a batch whose last day is over, recording what it did. Safe to call repeatedly. */
export async function closeEndedBatch(agent: Agent) {
  const batch = await getActiveBatch(agent.id);
  if (!batch?.ends_on) return null;
  const today = DateTime.now().setZone(agent.timezone);
  if (today.toISODate()! <= batch.ends_on) return null;
  // The last day's spend must be pulled from Meta first: closing on an older sync would count too little
  // spend and return too much to the balance (and that refund is never corrected)
  if (agent.meta_ad_account_id) {
    try {
      await syncAgent(agent);
    } catch (e) {
      const daysOver = Math.floor(today.diff(DateTime.fromISO(batch.ends_on, { zone: agent.timezone }), "days").days);
      if (daysOver < CLOSE_WITHOUT_SYNC_DAYS) throw e;
      console.error("closing the batch on its last synced spend", e);
    }
  }
  const r = await results(agent, batch.starts_on, batch.ends_on);
  const result = { spent_cents: r.spentCents, booked_calls: r.bookedCalls };
  // Only the caller that actually flips it to "ended" tells the agent (the page and a review can race)
  const { data: closed } = await supabaseAdmin
    .from("campaign_batches")
    .update({ status: "ended", ended_at: new Date().toISOString(), result })
    .eq("id", batch.id)
    .eq("status", "active")
    .select("id");
  if (closed?.length) {
    await returnUnspent(agent, batch, r.spentCents);
    await notifyBatchEnded(agent, { budgetCents: batch.budget_cents, spentCents: r.spentCents, bookedCalls: r.bookedCalls });
  }
  return { ...batch, status: "ended" as const, result };
}

