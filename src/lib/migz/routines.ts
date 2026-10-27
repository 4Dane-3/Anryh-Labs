import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { begin } from "@/lib/migz/events";
import { present } from "@/lib/migz/metrics";
import { callModel, jsonOf, planTier, type Budget, type CreateMessage } from "@/lib/migz/router";
import type { Snapshot } from "@/lib/migz/snapshot";
import { writeWeeklySlack } from "@/lib/migz/team/clerk";
import { getBatchHistory } from "@/lib/dashboard/batches";
import { budgetMath, ownCostPerCall, PLAYBOOK, scaleAdvice, type BudgetMath } from "@/lib/migz/playbook";

// The routines a good media buyer runs on a calendar, as code that creates findings and context:
//  daily     spend anomalies (pacing, disapprovals and tracking are checked by the auditor every run)
//  ~3.5 days fatigue check and the creative refresh queue
//  weekly    winners/losers, scale and consolidation candidates, the Opus strategy memo, Slack report
//  every run the strategist's checks: is the account built the way its budget needs, and is the
//            bottleneck the ads or the booking page (findings the review acts on)

export const DAILY_HOURS = 24;
export const FATIGUE_HOURS = 84; // every 3.5 days
export const WEEKLY_HOURS = 168;
export const FATIGUE_THRESHOLD = 0.3;

type Team = { runId: string; budget: Budget; createMessage: CreateMessage };

const dueBy = (last: string | null, hours: number, now: Date) => !last || now.getTime() - new Date(last).getTime() >= hours * 3_600_000;

export function routinesDue(agent: Pick<Agent, "migz_last_daily_at" | "migz_last_fatigue_at" | "migz_last_weekly_at">, now = new Date()) {
  return {
    daily: dueBy(agent.migz_last_daily_at, DAILY_HOURS, now),
    fatigue: dueBy(agent.migz_last_fatigue_at, FATIGUE_HOURS, now),
    weekly: dueBy(agent.migz_last_weekly_at, WEEKLY_HOURS, now),
  };
}

/** Closes this routine's open findings whose subject isn't in `keep`. */
async function resolveOthers(agentId: string, check: string, keep: string[]) {
  const { data } = await supabaseAdmin.from("audit_findings").select("subject").eq("agent_id", agentId).eq("check_name", check).eq("status", "open");
  const stale = (data ?? []).map((f) => f.subject).filter((s) => !keep.includes(s));
  if (stale.length)
    await supabaseAdmin.from("audit_findings").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("agent_id", agentId).eq("check_name", check).in("subject", stale);
}

async function upsertFinding(agentId: string, f: { check: string; subject: string; severity: "info" | "warn" | "critical"; summary: string; evidence: Record<string, unknown> }) {
  await supabaseAdmin.from("audit_findings").upsert(
    { agent_id: agentId, check_name: f.check, subject: f.subject, severity: f.severity, summary: f.summary, evidence: f.evidence, status: "open", last_seen: new Date().toISOString(), resolved_at: null },
    { onConflict: "agent_id,check_name,subject" },
  );
}

/** Live ads ranked on the weekly scoreboard. Pure, for the memo and the Brain page. */
export function scoreboard(snapshot: Snapshot) {
  const live = snapshot.guardAdsets.flatMap((s) => s.ads.filter((a) => a.status === "ACTIVE").map((a) => ({ adset: s.meta_adset_id, ad: a.meta_ad_id })));
  const rows = live
    .map(({ adset, ad }) => {
      const m = snapshot.adMetrics.get(ad);
      return m ? { adset, ad, d: m.d14, fatigue: m.fatigue } : null;
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.d.impressions >= 1000);
  // Booked calls first (the only conversion that matters), then link click-through as the tiebreak
  rows.sort((a, b) => (b.d.booked_calls - a.d.booked_calls) || ((b.d.link_ctr ?? b.d.ctr ?? 0) - (a.d.link_ctr ?? a.d.ctr ?? 0)));
  return rows;
}

const MEMO_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    learned: { type: "array", items: { type: "string" }, description: "What this week taught, each one specific with numbers." },
    test_next: { type: "array", items: { type: "string" } },
    stop: { type: "array", items: { type: "string" } },
    growth: {
      type: "object",
      description: "The money call for the agent: put more behind what's working, keep going, or fix something first so more money can book.",
      properties: {
        move: { type: "string", enum: ["add_budget", "keep_going", "fix_first"] },
        why: { type: "string", description: "For the agent, in plain words, with this account's numbers (cost per booked call when there is one)." },
      },
      required: ["move", "why"],
      additionalProperties: false,
    },
  },
  required: ["headline", "learned", "test_next", "stop", "growth"],
  additionalProperties: false,
};

type Memo = { headline: string; learned: string[]; test_next: string[]; stop: string[]; growth: { move: "add_budget" | "keep_going" | "fix_first"; why: string } };

const MEMO_SYSTEM = `You are the senior strategist on Migz AI's ad team: a media buyer with years of running Meta ads for independent life insurance agents. Each week you write the strategy memo for one agent. You get the week's scoreboard, experiments, learnings, audit findings, actions, the strategist's checks (budget_math: what the budget buys and how many ad sets it supports; booking_page: where the ads' visitors stop) and, once the account has bookings, what more money should bring.

Say what was learned (specific, with numbers, compared against this account's own averages), what to test next (one lever at a time, with the metric that decides it), what to stop, and the growth call:
- add_budget: the ads book at a cost per call worth scaling. Say how much more and how many more calls it should bring, from more_money_should_bring.
- fix_first: something stops the money from turning into bookings (the booking page, the account's structure, tracking). Name it and what to change.
- keep_going: the plan is sound and needs more data; say what the next week should show.
Results from the last 24 hours are incomplete because of attribution delay; weigh them lightly. Don't invent numbers.

${PLAYBOOK}`;

async function weeklyMemo(agent: Agent, snapshot: Snapshot, team: Team, strategy: Strategy) {
  const plan = planTier("memo", team.budget);
  if (!plan) return null;
  const since = DateTime.now().minus({ days: 7 }).toUTC().toISO()!;
  const [{ data: experiments }, { data: learnings }, { data: findings }, { data: actions }] = await Promise.all([
    supabaseAdmin.from("experiments").select("hypothesis, lever, status, verdict, winner_label, result").eq("agent_id", agent.id).or(`status.neq.concluded,concluded_at.gte.${since}`),
    supabaseAdmin.from("learnings").select("insight, confidence").eq("agent_id", agent.id).eq("active", true).order("created_at", { ascending: false }).limit(15),
    supabaseAdmin.from("audit_findings").select("check_name, severity, summary").eq("agent_id", agent.id).eq("status", "open"),
    supabaseAdmin.from("ad_actions").select("title, detail, status, created_at").eq("agent_id", agent.id).gte("created_at", since).order("created_at"),
  ]);
  const board = scoreboard(snapshot).map((r) => ({ ad: r.ad, adset: r.adset, ...present(r.d), fatigue: r.fatigue.signals }));
  const input = {
    account_last_14_days: snapshot.forModel.account_last_14_days,
    budget_math: strategy.math.text,
    booking_page: snapshot.forModel.booking_page_last_14_days,
    more_money_should_bring: strategy.scale?.text ?? "unknown until the account has a few booked calls",
    scoreboard: board,
    experiments,
    learnings,
    open_findings: findings,
    actions_this_week: actions,
  };

  const done = await begin({ agentId: agent.id, runId: team.runId, step: "remembering", tier: plan.tier, model: null, summary: "Writing the weekly strategy memo" });
  const res = await callModel({
    task: "memo",
    tier: plan.tier,
    degraded: plan.degraded,
    agentId: agent.id,
    runId: team.runId,
    createMessage: team.createMessage,
    params: {
      max_tokens: 8000,
      output_config: { effort: "high", format: { type: "json_schema", schema: MEMO_SCHEMA } },
      system: [{ type: "text", text: MEMO_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(input) }],
    },
  });
  const memo = jsonOf<Memo>(res.message);
  if (memo?.learned.length) {
    await supabaseAdmin.from("learnings").insert(
      memo.learned.slice(0, 5).map((insight) => ({ agent_id: agent.id, insight: insight.slice(0, 400), confidence: "medium", source: "memo", evidence: { week_ending: DateTime.now().toISODate() } })),
    );
  }
  if (memo?.growth) {
    // The money call stays in front of every review until next week's memo replaces it
    await resolveOthers(agent.id, "strategy_growth", [memo.growth.move]);
    await upsertFinding(agent.id, { check: "strategy_growth", subject: memo.growth.move, severity: memo.growth.move === "fix_first" ? "warn" : "info", summary: memo.growth.why.slice(0, 600), evidence: { week_ending: DateTime.now().toISODate() } });
  }
  await done({ summary: memo ? `Strategy memo: ${memo.headline}` : "Couldn't write this week's memo", evidence: memo ?? {}, inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
  return memo;
}

type Strategy = { math: BudgetMath; scale: ReturnType<typeof scaleAdvice>; findings: { check: string; summary: string }[]; newlyFlagged: boolean };

/**
 * The strategist's checks on every review: whether the account is built the way its budget needs
 * (budget math) and whether the ads' visitors stop on the booking page. Both are filed as findings the
 * review reads; they resolve themselves once fixed.
 */
async function strategyChecks(agent: Agent, snapshot: Snapshot): Promise<Strategy> {
  const history = await getBatchHistory(agent);
  const liveMain = snapshot.guardAdsets.filter((s) => s.status === "ACTIVE" && s.role !== "explore").length;
  const math = budgetMath({ dailyCents: agent.daily_budget_cents, adsets: liveMain, costPerCallCents: ownCostPerCall(history.spentCents, history.bookedCalls) });
  const scale = scaleAdvice({ spentCents: history.spentCents, bookedCalls: history.bookedCalls, extraCents: Math.max(agent.daily_budget_cents * 14, 28_000) });

  const { data: open } = await supabaseAdmin.from("audit_findings").select("check_name, subject").eq("agent_id", agent.id).eq("status", "open").in("check_name", ["strategy_structure", "strategy_bottleneck"]);
  const wasOpen = new Set((open ?? []).map((f) => `${f.check_name}|${f.subject}`));
  const findings: Strategy["findings"] = [];
  let newlyFlagged = false;
  const file = async (check: string, subject: string, summary: string, evidence: Record<string, unknown>) => {
    await upsertFinding(agent.id, { check, subject, severity: "warn", summary, evidence });
    findings.push({ check, summary });
    if (!wasOpen.has(`${check}|${subject}`)) newlyFlagged = true;
  };

  if (math.verdict === "consolidate") {
    await file("strategy_structure", "split", `${math.text} Use restructure to fold it into one campaign with one ad set.`, { adsets: liveMain, daily_cents: agent.daily_budget_cents, calls_per_week_per_adset: math.callsPerWeekPerAdset });
  }
  await resolveOthers(agent.id, "strategy_structure", math.verdict === "consolidate" ? ["split"] : []);

  const page = snapshot.forModel.booking_page_last_14_days;
  const pageFix = typeof page === "object" && (page.fix_is_in === "page" || page.fix_is_in === "both") ? page : null;
  if (pageFix) await file("strategy_bottleneck", pageFix.fix_is_in, pageFix.verdict, { visits_from_ads: pageFix.visits_from_ads, saw_the_times: pageFix.saw_the_times, picked_a_time: pageFix.picked_a_time });
  await resolveOthers(agent.id, "strategy_bottleneck", pageFix ? [pageFix.fix_is_in] : []);

  return { math, scale, findings, newlyFlagged };
}

/**
 * Runs whichever routines are due. Returns the reasons they add for a full review and the context
 * the operator reads (refresh queue, scoreboard, this week's memo).
 */
export async function runRoutines(agent: Agent, snapshot: Snapshot, team: Team, now = new Date()) {
  const due = routinesDue(agent, now);
  const reasons: string[] = [];
  const context: Record<string, unknown> = {};
  const stamps: Record<string, string> = {};
  if (!snapshot.hasCampaign) return { reasons, context };

  const strategy = await strategyChecks(agent, snapshot);
  const { data: growth } = await supabaseAdmin.from("audit_findings").select("subject, summary").eq("agent_id", agent.id).eq("check_name", "strategy_growth").eq("status", "open").maybeSingle();
  context.strategist = {
    note: "The strategist's standing calls for this account. Act on them in this review where the tools allow, and explain in your summary when you can't yet.",
    budget_math: strategy.math.text,
    calls: strategy.findings.map((f) => f.summary),
    growth: growth ? { move: growth.subject, why: growth.summary } : "the weekly memo hasn't made a growth call yet",
    ...(strategy.scale ? { more_money_should_bring: strategy.scale.text } : {}),
  };
  if (strategy.newlyFlagged) reasons.push("the strategist flagged the account's setup");

  if (due.daily) {
    // Spend anomaly: yesterday vs the 7 days before it (yesterday is complete, today isn't)
    const days = new Map<string, number>();
    const { data } = await supabaseAdmin
      .from("ad_insights_daily")
      .select("date, spend_cents")
      .eq("agent_id", agent.id)
      .gte("date", DateTime.now().setZone(agent.timezone).minus({ days: 8 }).toISODate()!);
    for (const r of data ?? []) days.set(r.date, (days.get(r.date) ?? 0) + r.spend_cents);
    const yesterday = DateTime.now().setZone(agent.timezone).minus({ days: 1 }).toISODate()!;
    const prior = [...days].filter(([d]) => d < yesterday).map(([, v]) => v);
    const avg = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : 0;
    const y = days.get(yesterday) ?? 0;
    const anomaly = avg > 0 && (y > avg * 1.6 || y < avg * 0.4);
    await resolveOthers(agent.id, "spend_anomaly", anomaly ? [yesterday] : []);
    if (anomaly) {
      await upsertFinding(agent.id, {
        check: "spend_anomaly",
        subject: yesterday,
        severity: "warn",
        summary: `Yesterday's spend was $${(y / 100).toFixed(2)} against a $${(avg / 100).toFixed(2)} daily average (${Math.round((y / avg) * 100)}%).`,
        evidence: { yesterday_cents: y, avg_cents: Math.round(avg) },
      });
      reasons.push("daily spend anomaly");
    }
    stamps.migz_last_daily_at = now.toISOString();
  }

  if (due.fatigue) {
    const queue = scoreboard(snapshot).filter((r) => r.fatigue.score >= FATIGUE_THRESHOLD);
    await resolveOthers(agent.id, "fatigue", queue.map((r) => r.ad));
    for (const r of queue)
      await upsertFinding(agent.id, { check: "fatigue", subject: r.ad, severity: "warn", summary: `Ad ${r.ad} is fatiguing: ${r.fatigue.signals.join("; ")}.`, evidence: { score: r.fatigue.score, signals: r.fatigue.signals } });
    context.creative_refresh_queue = queue.map((r) => ({ ad_id: r.ad, fatigue_score: r.fatigue.score, signals: r.fatigue.signals }));
    if (queue.length) reasons.push("fatigue check found ads to refresh");
    stamps.migz_last_fatigue_at = now.toISOString();
  }

  if (due.weekly) {
    const board = scoreboard(snapshot);
    const scale = snapshot.guardAdsets.filter((s) => s.status === "ACTIVE" && (s.learning_status ?? "").toUpperCase() !== "LEARNING" && s.ads.some((a) => board[0]?.ad === a.meta_ad_id));
    const thin = snapshot.guardAdsets.filter((s) => s.status === "ACTIVE" && s.daily_budget_cents < 1000 && snapshot.guardAdsets.length > 1);
    context.weekly_review = {
      winners: board.slice(0, 2).map((r) => ({ ad_id: r.ad, ...present(r.d) })),
      losers: (board.length > 2 ? board.slice(-2) : []).map((r) => ({ ad_id: r.ad, ...present(r.d) })),
      scale_candidates: scale.map((s) => ({ adset_id: s.meta_adset_id, note: "Winner outside learning: scale in steps of at most 30%." })),
      consolidation_candidates: thin.map((s) => ({ adset_id: s.meta_adset_id, note: "Under $10/day: too thin to exit learning; consider merging." })),
      attribution_note: "Results from the last 24 hours are incomplete (attribution delay).",
    };
    const memo = await weeklyMemo(agent, snapshot, team, strategy);
    if (memo) {
      context.strategy_memo = memo;
      if (agent.slack_user_id && process.env.SLACK_BOT_TOKEN) {
        const notes = JSON.stringify({ memo, account_last_14_days: snapshot.forModel.account_last_14_days, weekly_review: context.weekly_review });
        const text = await writeWeeklySlack(notes, { agentId: agent.id, runId: team.runId, budget: team.budget, createMessage: team.createMessage });
        await sendSlackMessage(agent.slack_user_id, text).catch(() => {});
      }
    }
    reasons.push("weekly routine due");
    stamps.migz_last_weekly_at = now.toISOString();
  }

  if (Object.keys(stamps).length) await supabaseAdmin.from("agents").update(stamps).eq("id", agent.id);
  return { reasons, context };
}
