import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { isTopic, TOPICS, type TopicKey } from "@/lib/migz/topics";
import { recommendOption, type BatchHistory, type BatchOption, type BatchOptionKey } from "@/lib/batch";
import { callModel, defaultCreateMessage, jsonOf, monthlyBudget, planTier, type CreateMessage } from "@/lib/migz/router";
import { notifyBatchEnded } from "@/lib/migz/notify";

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
};

const COLS = "id, status, budget_cents, option, campaigns, days, daily_cents, recommended_option, reason, starts_on, ends_on, applied_at, result, created_at, started_at, ended_at";

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

/** Everything this agent's ads have done so far. Never another agent's data. */
export async function getBatchHistory(agent: Agent): Promise<BatchHistory> {
  const [r, { count }] = await Promise.all([
    results(agent),
    supabaseAdmin.from("campaign_batches").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("status", "ended"),
  ]);
  return { ...r, batches: count ?? 0 };
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

/** Closes a batch whose last day is over, recording what it did. Safe to call repeatedly. */
export async function closeEndedBatch(agent: Agent) {
  const batch = await getActiveBatch(agent.id);
  if (!batch?.ends_on) return null;
  if (DateTime.now().setZone(agent.timezone).toISODate()! <= batch.ends_on) return null;
  const r = await results(agent, batch.starts_on, batch.ends_on);
  const result = { spent_cents: r.spentCents, booked_calls: r.bookedCalls };
  // Only the caller that actually flips it to "ended" tells the agent (the page and a review can race)
  const { data: closed } = await supabaseAdmin
    .from("campaign_batches")
    .update({ status: "ended", ended_at: new Date().toISOString(), result })
    .eq("id", batch.id)
    .eq("status", "active")
    .select("id");
  if (closed?.length) await notifyBatchEnded(agent, { budgetCents: batch.budget_cents, spentCents: r.spentCents, bookedCalls: r.bookedCalls });
  return { ...batch, status: "ended" as const, result };
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    option: { type: "string", enum: ["focused", "balanced", "spread"] },
    reason: { type: "string", description: "Why, in one or two plain sentences for the agent. Cite their numbers when there are any." },
  },
  required: ["option", "reason"],
  additionalProperties: false,
};

const PLAN_SYSTEM = `You are Migz AI, the media buyer running Meta ads for an independent life insurance agent. The agent is putting a new batch of money into their ads and you're choosing how to spend it, from the options given. The goal is the most booked calls for the money. Guidance: with little or no booking data, one campaign per focus (balanced) usually finds the best topic fastest; once one topic clearly books cheaper, focusing the batch on it usually brings the most calls; spreading wide suits a larger budget with no clear winner. A single focused campaign gives up the comparison between campaigns, so recommend it only with a reason. Use only the agent's own numbers you're given; never invent results. Write the reason for the agent: plain words, no jargon, no promises.`;

/**
 * Migz's pick among the options, with its reason. Sonnet decides from the agent's own history and
 * learnings; when the model is unavailable (or over this month's budget), the rule-based pick stands.
 */
export async function recommendWithMigz(
  agent: Agent,
  input: { budgetCents: number; focus: TopicKey[]; options: BatchOption[]; history: BatchHistory },
  createMessage: CreateMessage = defaultCreateMessage,
): Promise<{ key: BatchOptionKey; reason: string; by: "migz" | "rules" }> {
  const fallback = { ...recommendOption(input.options, input.focus, input.history), by: "rules" as const };
  if (input.options.length < 2) return fallback;
  try {
    const budget = await monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000);
    const plan = planTier("batch_plan", budget);
    if (!plan) return fallback;
    const { data: learnings } = await supabaseAdmin.from("learnings").select("insight, confidence").eq("agent_id", agent.id).eq("active", true).order("created_at", { ascending: false }).limit(8);
    const facts = {
      batch_budget: `$${(input.budgetCents / 100).toFixed(2)} of ad spend`,
      focus_in_order: input.focus.map((t) => TOPICS[t].label),
      options: input.options.map((o) => ({ option: o.key, plan: o.blurb })),
      history: {
        spent_so_far: `$${(input.history.spentCents / 100).toFixed(2)}`,
        booked_calls_so_far: input.history.bookedCalls,
        batches_finished: input.history.batches,
        by_topic: Object.fromEntries(
          Object.entries(input.history.byTopic).map(([t, v]) => [TOPICS[t as TopicKey].label, { spent: `$${(v!.spentCents / 100).toFixed(2)}`, booked_calls: v!.bookedCalls }]),
        ),
      },
      what_this_account_learned: (learnings ?? []).map((l) => `${l.insight} (${l.confidence})`),
      rule_based_pick: fallback,
    };
    const res = await callModel({
      task: "batch_plan",
      tier: plan.tier,
      agentId: agent.id,
      runId: null,
      createMessage,
      params: {
        max_tokens: 500,
        output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
        system: [{ type: "text", text: PLAN_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: JSON.stringify(facts) }],
      },
    });
    const pick = jsonOf<{ option: BatchOptionKey; reason: string }>(res.message);
    if (!pick || !input.options.some((o) => o.key === pick.option) || !pick.reason?.trim()) return fallback;
    return { key: pick.option, reason: pick.reason.trim().slice(0, 400), by: "migz" };
  } catch (e) {
    console.error("batch recommendation failed", e);
    return fallback;
  }
}
