import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { TOPICS } from "@/lib/migz/topics";
import { bestTopic } from "@/lib/batch";
import { BATCH_COLS, getBatchHistory, type Batch } from "@/lib/dashboard/batches";
import { WEAK_CTR_BELOW } from "@/lib/migz/guardrails";
import { cleanFocus } from "@/lib/migz/topics";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier } from "@/lib/ad-options";
import type { CampaignStart } from "@/components/dashboard/start/CampaignFlow";
import {
  cleanAnswers,
  DAILY_CHOICES,
  MAX_CAMPAIGN_DAILY_CENTS,
  MIN_CAMPAIGN_DAILY_CENTS,
  expectedResults,
  lengthReason,
  recommendedDaily,
  recommendedDays,
  LEARNING_RESULTS_PER_WEEK,
  costAdjustments,
  type CampaignAnswers,
  type CampaignPlan,
  type OwnNumbers,
} from "@/lib/campaign-plan";
import type { IntentLevel } from "@/lib/ad-options";
import { outcomesByAd } from "@/lib/dashboard/outcomes";
import { MIN_OUTCOMES, outcomeStats } from "@/lib/outcomes";

// Migz AI's plan for a new campaign, from this agent's own past campaigns (never anyone else's): what it
// learned, with the evidence, what it will do differently, the budget it recommends and the range to
// expect. Shown on the start flow's last screen and, once the campaign starts, on the Brain page.

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0, minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const MIN_IMPRESSIONS = 1000;

/** Booked calls and form leads across the agent's finished campaigns, and what each cost. */
export async function ownNumbers(agent: Agent, ended: Batch[]): Promise<OwnNumbers> {
  const spent = ended.reduce((s, b) => s + (b.result?.spent_cents ?? 0), 0);
  const booked = ended.reduce((s, b) => s + (b.result?.booked_calls ?? 0), 0);
  let leads = 0;
  if (ended.length) {
    const from = ended.at(-1)!.starts_on;
    const { data } = await supabaseAdmin.from("quote_requests").select("id").eq("agent_id", agent.id).eq("source", "instant_form").gte("created_at", from ?? "2000-01-01");
    leads = data?.length ?? 0;
  }
  // Show-up and reach rates from the agent's answers (all their calls and leads; none before the outcomes migration)
  const [{ data: calls, error: callsError }, { data: formLeads, error: leadsError }] = await Promise.all([
    supabaseAdmin.from("bookings").select("outcome").eq("agent_id", agent.id).eq("status", "confirmed").not("outcome", "is", null),
    supabaseAdmin.from("quote_requests").select("outcome").eq("agent_id", agent.id).not("outcome", "is", null),
  ]);
  const showRate = callsError ? null : outcomeStats((calls ?? []).map((c) => c.outcome as string)).goodRate;
  const reachRate = leadsError ? null : outcomeStats((formLeads ?? []).map((c) => c.outcome as string), "lead").goodRate;
  return {
    campaigns: ended.length,
    // Enough results to trust: 3 booked calls, 5 form leads
    costPerCallCents: booked >= 3 ? Math.round(spent / booked) : null,
    costPerLeadCents: leads >= 5 ? Math.round(spent / leads) : null,
    showRate,
    reachRate,
  };
}

type AdRow = { meta_ad_id: string; name: string; headline: string | null; status: string; creatives: { script?: { concept?: string; format?: string } | null } | null };

/** Each ad's link clicks and impressions over its whole life (last 90 days), with what it was. */
async function adResults(agent: Agent) {
  const since = DateTime.now().setZone(agent.timezone).minus({ days: 90 }).toISODate()!;
  const [{ data: rows }, { data: ads }] = await Promise.all([
    supabaseAdmin.from("ad_insights_daily").select("meta_ad_id, impressions, link_clicks, spend_cents").eq("agent_id", agent.id).gte("date", since),
    supabaseAdmin.from("ads").select("meta_ad_id, name, headline, status, creatives(script)").eq("agent_id", agent.id),
  ]);
  const byAd = new Map<string, { impressions: number; clicks: number; spend: number }>();
  for (const r of rows ?? []) {
    const e = byAd.get(r.meta_ad_id) ?? { impressions: 0, clicks: 0, spend: 0 };
    e.impressions += r.impressions;
    e.clicks += r.link_clicks ?? 0;
    e.spend += r.spend_cents;
    byAd.set(r.meta_ad_id, e);
  }
  return ((ads ?? []) as unknown as AdRow[])
    .map((a) => ({ ...a, ...(byAd.get(a.meta_ad_id) ?? { impressions: 0, clicks: 0, spend: 0 }) }))
    .filter((a) => a.impressions >= MIN_IMPRESSIONS)
    .map((a) => ({ ...a, ctr: a.clicks / a.impressions, label: a.creatives?.script?.concept || a.headline || a.name }));
}

export async function buildCampaignPlan(agent: Agent, input: { answers: CampaignAnswers; states: string[]; intent: IntentLevel; dailyCents: number }): Promise<CampaignPlan> {
  const { data } = await supabaseAdmin.from("campaign_batches").select(BATCH_COLS).eq("agent_id", agent.id).eq("status", "ended").order("ended_at", { ascending: false }).limit(6);
  const ended = (data ?? []) as Batch[];
  const own = await ownNumbers(agent, ended);
  const days = recommendedDays(input.dailyCents);
  const expected = expectedResults({ ...input, days, own });
  const main = expected.lines.find((l) => l.destination === "website") ?? expected.lines[0];
  const recommendedDailyCents = recommendedDaily(main.cost.mid);
  const budgetWhy = (source: string) =>
    `About ${LEARNING_RESULTS_PER_WEEK} ${main.unit}s a week gives Meta enough to learn from. At ${source} ${usd(main.cost.mid)} per ${main.unit}, that's about ${usd(recommendedDailyCents)}/day.${
      input.dailyCents < recommendedDailyCents * 0.6 ? ` At ${usd(input.dailyCents)}/day it still works, it just learns slower, so Migz runs it longer.` : ""
    } ${lengthReason(input.dailyCents, days)}`;

  if (!ended.length) {
    const adj = costAdjustments(input.answers, input.states);
    return {
      first: true,
      learned: [],
      changes: [
        "This is your first campaign, so Migz starts from typical numbers for US life insurance on Meta, adjusted for your answers. After it ends, Migz plans from your own results.",
        "Every creative launches on day one, each on a different angle, and Meta finds which ones book. Nothing new is added partway through, so Meta can learn.",
        ...(adj.notes.length ? [`Your answers move the typical numbers: ${adj.notes.map((n) => n.text.replace(/\.$/, "")).join("; ")}.`] : []),
      ],
      budget: { dailyCents: input.dailyCents, days, recommendedDailyCents, why: budgetWhy(`a typical`) },
      expected,
      createdAt: new Date().toISOString(),
    };
  }

  const learned: CampaignPlan["learned"] = [];
  const changes: string[] = [];

  // Each finished campaign's numbers, newest first
  for (const b of ended.slice(0, 3)) {
    const spent = b.result?.spent_cents ?? 0;
    const calls = b.result?.booked_calls ?? 0;
    learned.push({
      text: `${b.starts_on ? DateTime.fromISO(b.starts_on).toFormat("LLL d") : "A campaign"}: ${calls} booked call${calls === 1 ? "" : "s"} from ${usd(spent)}${calls ? ` (${usd(Math.round(spent / calls))} each)` : ""}.`,
      evidence: `${usd(b.daily_cents)}/day for ${b.days} days, ${b.starts_on} to ${b.ends_on}.`,
    });
  }

  const [history, ads, { data: notes }, { data: rejected }, byAd] = await Promise.all([
    getBatchHistory(agent),
    adResults(agent),
    supabaseAdmin.from("learnings").select("insight, confidence, created_at").eq("agent_id", agent.id).eq("active", true).in("confidence", ["medium", "high"]).order("created_at", { ascending: false }).limit(3),
    supabaseAdmin.from("ad_rejections").select("reasons, hook_line, headline").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(5),
    outcomesByAd(agent.id),
  ]);

  // Which ads' bookings actually show up (once an ad has enough answered calls)
  const labelOf = new Map(ads.map((a) => [a.meta_ad_id, a.label]));
  const showing = [...byAd]
    .map(([id, o]) => ({ id, label: labelOf.get(id) ?? "An ad", s: outcomeStats(o) }))
    .filter((x) => x.s.goodRate !== null)
    .sort((a, b) => b.s.goodRate! - a.s.goodRate!);
  if (showing.length >= 2 && showing[0].s.goodRate! - showing.at(-1)!.s.goodRate! >= 0.2) {
    const [top, low] = [showing[0], showing.at(-1)!];
    const pct = (r: number) => `${Math.round(r * 100)}%`;
    learned.push({
      text: `"${top.label}"'s bookings show up ${pct(top.s.goodRate!)} of the time, "${low.label}"'s ${pct(low.s.goodRate!)}.`,
      evidence: `From your answers: ${top.s.good} of ${top.s.answered} and ${low.s.good} of ${low.s.answered} calls${top.s.sold ? `; "${top.label}" sold ${top.s.sold}` : ""}.`,
    });
    changes.push(`Builds on "${top.label}" (its bookings show up and buy) and drops what "${low.label}" does, even though both book.`);
  } else if (showing.length === 1) {
    const one = showing[0];
    learned.push({ text: `"${one.label}"'s bookings show up ${Math.round(one.s.goodRate! * 100)}% of the time.`, evidence: `${one.s.good} of ${one.s.answered} answered calls${one.s.sold ? `, ${one.s.sold} sold` : ""}.` });
  } else if (!showing.length && [...byAd.values()].flat().filter(Boolean).length < MIN_OUTCOMES) {
    changes.push("Ranks ads on booked calls for now. Tell Migz how your calls go (one tap after each) and it ranks them on who shows up and buys.");
  }

  const best = [...ads].sort((a, b) => b.ctr - a.ctr)[0];
  if (best && best.ctr >= WEAK_CTR_BELOW) {
    learned.push({ text: `"${best.label}" got the most clicks of your ads.`, evidence: `${(best.ctr * 100).toFixed(1)}% of ${best.impressions.toLocaleString("en-US")} people who saw it clicked.` });
    changes.push(`Keeps "${best.label}" running and builds new creatives on the same angle, with new hooks and formats.`);
  }
  const weak = ads.filter((a) => a.ctr < WEAK_CTR_BELOW);
  if (weak.length) {
    learned.push({
      text: `${weak.length} ad${weak.length === 1 ? "" : "s"} got under ${WEAK_CTR_BELOW * 100}% of viewers to click.`,
      evidence: weak.slice(0, 3).map((a) => `"${a.label}" ${(a.ctr * 100).toFixed(1)}%`).join(", "),
    });
    changes.push(`Retires the ads under ${WEAK_CTR_BELOW * 100}% clicks and replaces them with different angles, not near-copies.`);
  }
  const topic = bestTopic(history);
  if (topic) {
    const t = history.byTopic[topic]!;
    learned.push({ text: `${TOPICS[topic].label} books calls clearly cheaper than your other topics.`, evidence: `${t.bookedCalls} booked calls from ${usd(t.spentCents)}.` });
    changes.push(`Leads with ${TOPICS[topic].label}: most of the new creatives are on it.`);
  }
  const verdict = history.page?.verdict;
  if (verdict && verdict.fix !== "none") {
    learned.push({ text: verdict.fix === "page" ? "People reach your booking page but stop before booking." : "Many people leave your page before they see the times.", evidence: verdict.text });
    changes.push(verdict.fix === "page" ? "Keeps the ads steady: the fix is on your booking page, and Migz says exactly where people stop." : "Makes the ads' offer match the top of your page (a free call with you).");
  }
  for (const n of notes ?? []) learned.push({ text: n.insight, evidence: `Migz's ${n.confidence}-confidence note from ${n.created_at.slice(0, 10)}.` });
  if (rejected?.length) {
    const reasons = [...new Set(rejected.flatMap((r) => (r.reasons as string[] | null) ?? []))].slice(0, 2);
    learned.push({ text: `Meta rejected ${rejected.length} of your ads.`, evidence: reasons.join(" · ") || "No reason given." });
    changes.push("Avoids the wording Meta rejected.");
  }
  if (!changes.length) changes.push("Nothing stood out clearly yet, so Migz keeps what's working and tests new angles from the start.");
  changes.push("Every creative launches on day one; nothing new is added partway through, so Meta can learn.");

  const source = own.costPerCallCents || own.costPerLeadCents ? "your" : "a typical";
  return { first: false, learned, changes, budget: { dailyCents: input.dailyCents, days, recommendedDailyCents, why: budgetWhy(source) }, expected, createdAt: new Date().toISOString() };
}

/** The start flow's starting point: the last campaign's answers and daily budget, and the agent's own numbers. */
export async function getCampaignStart(agent: Agent): Promise<{ initial: CampaignStart; own: OwnNumbers | null }> {
  const [{ data: ended }, { data: last }] = await Promise.all([
    supabaseAdmin.from("campaign_batches").select(BATCH_COLS).eq("agent_id", agent.id).eq("status", "ended").order("ended_at", { ascending: false }).limit(6),
    supabaseAdmin.from("campaign_batches").select("daily_cents, renew").eq("agent_id", agent.id).neq("status", "canceled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const own = await ownNumbers(agent, (ended ?? []) as Batch[]);
  const answers = cleanAnswers(agent.campaign_answers);
  if (!answers.products.length) answers.products = cleanFocus(agent.ad_focus);
  const daily = last?.daily_cents ?? agent.daily_budget_cents ?? DAILY_CHOICES[3];
  return {
    initial: {
      answers,
      states: agent.licensed_states ?? [],
      intent: isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT,
      tier: isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER,
      dailyCents: Math.min(MAX_CAMPAIGN_DAILY_CENTS, Math.max(MIN_CAMPAIGN_DAILY_CENTS, daily)),
      autoRun: agent.migz_mode === "auto",
      renew: last?.renew ?? false,
    },
    own: own.campaigns >= 2 || own.showRate != null || own.reachRate != null ? own : null,
  };
}
