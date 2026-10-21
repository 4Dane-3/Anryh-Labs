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

// The routines a good media buyer runs on a calendar, as code that creates findings and context:
//  daily     spend anomalies (pacing, disapprovals and tracking are checked by the auditor every run)
//  ~3.5 days fatigue check and the creative refresh queue
//  weekly    winners/losers, scale and consolidation candidates, the Opus strategy memo, Slack report

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
  },
  required: ["headline", "learned", "test_next", "stop"],
  additionalProperties: false,
};

const MEMO_SYSTEM = `You are the senior strategist on Migz AI's ad team, writing the weekly strategy memo for one independent life insurance agent's Meta ads. You get the week's scoreboard, experiments, learnings, audit findings and actions. Say what was learned (specific, with numbers, compared against this account's own averages), what to test next (one lever at a time, with the metric that decides it), and what to stop. Results from the last 24 hours are incomplete because of attribution delay; weigh them lightly. Don't invent numbers.`;

async function weeklyMemo(agent: Agent, snapshot: Snapshot, team: Team) {
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
  const input = { account_last_14_days: snapshot.forModel.account_last_14_days, scoreboard: board, experiments, learnings, open_findings: findings, actions_this_week: actions };

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
  const memo = jsonOf<{ headline: string; learned: string[]; test_next: string[]; stop: string[] }>(res.message);
  if (memo?.learned.length) {
    await supabaseAdmin.from("learnings").insert(
      memo.learned.slice(0, 5).map((insight) => ({ agent_id: agent.id, insight: insight.slice(0, 400), confidence: "medium", source: "memo", evidence: { week_ending: DateTime.now().toISODate() } })),
    );
  }
  await done({ summary: memo ? `Strategy memo: ${memo.headline}` : "Couldn't write this week's memo", evidence: memo ?? {}, inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
  return memo;
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
    if (avg > 0 && (y > avg * 1.6 || y < avg * 0.4)) {
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
      losers: board.slice(-2).filter((r) => board.length > 2).map((r) => ({ ad_id: r.ad, ...present(r.d) })),
      scale_candidates: scale.map((s) => ({ adset_id: s.meta_adset_id, note: "Winner outside learning: scale in steps of at most 30%." })),
      consolidation_candidates: thin.map((s) => ({ adset_id: s.meta_adset_id, note: "Under $10/day: too thin to exit learning; consider merging." })),
      attribution_note: "Results from the last 24 hours are incomplete (attribution delay).",
    };
    const memo = await weeklyMemo(agent, snapshot, team);
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
