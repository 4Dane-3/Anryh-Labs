import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSlotBoard, type Agent } from "@/lib/booking/data";
import { pageAnalytics, type EventRow } from "@/lib/admin/page-analytics";
import { recordEventAlert } from "@/lib/admin/alerts";
import { getActiveBatch, getBatchProgress } from "@/lib/dashboard/batches";
import { REVISE_AFTER_DAYS } from "@/lib/campaign";
import { buildSnapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
import { getLiveStats } from "@/lib/migz/live";
import { callModel, defaultCreateMessage, jsonOf, monthlyBudget, planTier, type CreateMessage } from "@/lib/migz/router";
import { carryOver, mergeThoughts, nightlyDue, phaseOf, type ModelThought, type Narrative, type NightlyNumbers, type Phase, type Thought } from "@/lib/migz/nightly-core";
import { pageFindings, pageWeekLine, type PageFacts, type PageFinding } from "@/lib/migz/page-findings";
import { notifyNightly } from "@/lib/migz/notify";
import { alertAdmin } from "@/lib/migz/slack";
import type { NightlyContent } from "@/lib/migz/slack-blocks";

// The nightly summary: at 9pm in each agent's own timezone Migz writes up the day (spend, results), what
// it changed (after the first week) or is thinking (during it), and how their booking page could
// convert better, then sends it in Slack. Migz keeps a notebook of thoughts that carries night to night:
// during the first week it can't change anything, so it collects ideas and tests them against each new
// day's numbers; afterwards it acts on the ones the data backs and reports what it did.

type ModelOut = {
  headline: string;
  happened: string[];
  budget_read: string;
  thoughts: ModelThought[];
  next: string[];
  page_note: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One plain sentence for the top of the message, at most 80 characters" },
    happened: { type: "array", items: { type: "string" }, description: "2 to 4 short bullets on what happened today" },
    budget_read: { type: "string", description: "One or two sentences on today's spend against the daily budget" },
    thoughts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id of the earlier thought this updates, or an empty string for a new one" },
          text: { type: "string", description: "The thought, at most 30 words" },
          kind: { type: "string", enum: ["test", "change", "watch"] },
          status: { type: "string", enum: ["considering", "testing", "ready", "done", "dropped"] },
          note: { type: "string", description: "What tonight's numbers say about it, at most 30 words" },
        },
        required: ["id", "text", "kind", "status", "note"],
        additionalProperties: false,
      },
    },
    next: { type: "array", items: { type: "string" }, description: "1 to 3 things Migz will do or test next" },
    page_note: { type: "string", description: "One sentence about the booking page if the numbers say something, else an empty string" },
  },
  required: ["headline", "happened", "budget_read", "thoughts", "next", "page_note"],
  additionalProperties: false,
};

const SYSTEM = `You are Migz AI, the media buyer that runs Meta (Facebook and Instagram) ads for an independent US life insurance agent. The agent is not a marketer: use plain words, no jargon, no hype, no emoji. It is 9pm where they are. You write tonight's summary of their day and keep your running notebook of thoughts.

Rules:
- Use only the numbers and facts you are given. Small numbers are small: say it's too early to tell instead of guessing. Never invent results, quotes or sources.
- Every ad idea must follow Meta's financial-ad rules: no guarantees, no implied approval, no prices or returns, and never call out age, health or other personal attributes.
- "happened": 2 to 4 short bullets about today: where the money went, which ads got attention, anything notable, booked calls.
- "budget_read": compare today's spend with the daily budget. If today ran over it, say Meta's ad sets can spend up to about 75% over a daily budget on a strong day and balance it out over the week, so the batch total is what to watch.
- "thoughts" is your notebook. You are given your thoughts from earlier nights (previous_thoughts). For each one, either return it with the same id and an updated status and note (test it against tonight's numbers: do they support it, weaken it, or say nothing yet?) or leave it out to let it go. Use an empty id for a new thought. Keep at most 6 active thoughts (considering, testing, ready). A thought is something you would change (change), try (test) or keep an eye on (watch).
  Statuses: considering = a new idea; testing = you're collecting evidence for it; ready = the data backs it and you will act as soon as you're allowed; done = you did it (only for things listed in changes_today); dropped = the data contradicted it.
- "next": 1 to 3 concrete things you will do or test next.
- "page_note": only if page_findings or the booking page numbers say something worth a sentence; otherwise an empty string. The findings themselves are listed for the agent separately, don't repeat them.

Phase "collecting": the first week of a batch is for gathering results. You cannot change budgets, pause ads or change placements until the date in collecting_until, so you have changed nothing. Never claim you changed anything and never use "done". Your job tonight is to think: build on your earlier thoughts, test them against the new day, and say what you will do on that date.
Phase "revising": you may now act. List nothing in "happened" about changes you didn't make; changes_today is the list of what you did, so mention the important ones in plain words. Thoughts move toward "done" (you did it) or "dropped" (the data said no). Say what you are testing next.`;

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

type Row = {
  local_date: string;
  phase: Phase;
  numbers: NightlyNumbers;
  thoughts: Thought[];
  narrative: Narrative;
  created_at: string;
};

/** Fetches the live page and looks at its hours, content and the week's visits. */
export async function gatherPageFacts(agent: Agent): Promise<PageFacts> {
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  let load: PageFacts["load"] = null;
  if (base && !/localhost|127\.0\.0\.1/.test(base)) {
    try {
      const res = await fetch(`${base}/${agent.slug}`, { cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "MigzPageCheck/1.0" } });
      load = { ok: res.ok, status: res.status };
    } catch {
      load = { ok: false, status: null };
    }
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [rules, board, testimonials, events] = await Promise.all([
    supabaseAdmin.from("availability_rules").select("weekday, end_time").eq("agent_id", agent.id),
    getSlotBoard(agent),
    supabaseAdmin.from("testimonials").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("published", true),
    supabaseAdmin.from("page_events").select("session_id, name, meta, created_at").eq("agent_id", agent.id).gte("created_at", weekAgo).order("created_at").limit(20000),
  ]);
  const horizon = Date.now() + 7 * 86_400_000;
  const hours = rules.data ?? [];
  let week: PageFacts["week"] = null;
  if (!events.error && events.data?.length) {
    const a = pageAnalytics(events.data as EventRow[], 7, agent.timezone);
    if (a.sessions)
      week = {
        visits: a.sessions,
        sawTimes: a.funnel[1].sessions,
        pickedTime: a.funnel[2].sessions,
        startedForm: a.funnel[3].sessions,
        booked: a.booked,
        errors: a.extras.errors,
        mobileShare: a.mobileShare,
        medianSeconds: a.medianSeconds,
      };
  }
  return {
    load,
    hasPhoto: !!agent.photo_url,
    bioChars: (agent.bio ?? "").length,
    headlineChars: (agent.headline ?? "").length,
    testimonials: testimonials.count ?? 0,
    requiredSteps: (agent.required_intake_steps ?? []).length,
    openSlots7d: board.open.filter((t) => Date.parse(t) < horizon).length,
    evenings: hours.some((r) => String(r.end_time) > "18:00"),
    weekends: hours.some((r) => r.weekday >= 6),
    hasHours: hours.length > 0,
    week,
  };
}

async function previousNights(agentId: string, before: string, limit = 3): Promise<Row[]> {
  const { data, error } = await supabaseAdmin
    .from("nightly_summaries")
    .select("local_date, phase, numbers, thoughts, narrative, created_at")
    .eq("agent_id", agentId)
    .lt("local_date", before)
    .order("local_date", { ascending: false })
    .limit(limit);
  return error ? [] : ((data ?? []) as Row[]);
}

export type NightlyResult =
  | { status: "skipped"; reason: string }
  | { status: "duplicate" }
  | { status: "written"; localDate: string; content: NightlyContent; sent: boolean; costUsd: number };

/**
 * Builds tonight's summary for one agent. With `save` it's stored (once per local day) and with `send` it
 * goes to the agent's Slack; a dry run (neither) returns what would have been written without touching anything.
 */
export async function writeNightly(
  agent: Agent,
  opts: { save?: boolean; send?: boolean; createMessage?: CreateMessage; now?: DateTime } = {},
): Promise<NightlyResult> {
  const save = opts.save ?? true;
  const send = opts.send ?? save;
  const now = (opts.now ?? DateTime.now()).setZone(agent.timezone);
  const localDate = now.toISODate()!;
  const dayStart = now.startOf("day");

  const prior = await previousNights(agent.id, localDate, 3);
  const carried = carryOver(prior[0]?.thoughts ?? []);

  // Fresh numbers first (the same sync a review runs); if Meta is unreachable, tonight uses what we have
  let syncNote = "";
  try {
    await syncAgent(agent);
  } catch (e) {
    syncNote = e instanceof Error ? e.message.slice(0, 120) : "sync failed";
  }
  const snapshot = await buildSnapshot(agent);
  if (!snapshot.hasCampaign) return { status: "skipped", reason: "no campaign yet" };

  const [live, batch, changes, experiments, pageFacts, yesterday] = await Promise.all([
    getLiveStats(agent, { fresh: true, date: localDate }),
    getActiveBatch(agent.id),
    supabaseAdmin.from("ad_actions").select("title, detail, tool").eq("agent_id", agent.id).eq("status", "applied").gte("created_at", dayStart.toUTC().toISO()!).order("created_at").limit(12),
    supabaseAdmin.from("experiments").select("hypothesis, lever, status, verdict").eq("agent_id", agent.id).in("status", ["running", "planned"]).limit(5),
    gatherPageFacts(agent),
    supabaseAdmin.from("ad_metrics_daily").select("spend_cents").eq("agent_id", agent.id).eq("date", dayStart.minus({ days: 1 }).toISODate()!).maybeSingle(),
  ]);
  const progress = batch?.starts_on ? await getBatchProgress(agent, batch) : null;
  const t = live.today;
  const numbers: NightlyNumbers = {
    spendCents: t.spendCents,
    budgetCents: t.budgetCents,
    yesterdaySpendCents: yesterday.data?.spend_cents ?? null,
    impressions: t.impressions,
    reach: t.reach,
    linkClicks: t.linkClicks,
    ctr: t.ctr,
    bookedCalls: t.bookedCalls,
    batch: batch && progress ? { spentCents: live.batch?.spentCents ?? progress.spentCents, budgetCents: batch.budget_cents, day: Math.min(progress.day, batch.days), days: batch.days } : null,
  };

  const phase = phaseOf(snapshot.revisionsFrom, localDate);
  const revisionsFrom = snapshot.revisionsFrom;
  const findings = pageFindings(pageFacts);
  const changeList = (changes.data ?? []).map((c) => ({ title: c.title, detail: String(c.detail ?? "").slice(0, 240) }));

  // Migz's own words, from the model; if it can't run tonight the numbers and page notes still go out
  const budget = await monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000, agent.timezone);
  const plan = planTier("nightly", budget);
  let narrative: Narrative = { headline: "Tonight's numbers", happened: [], budget_read: "", next: [], page_note: "", fallback: true };
  let thoughts: Thought[] = carried.map((x) => ({ ...x, nights: x.nights + 1 }));
  let costUsd = 0;
  if (plan) {
    try {
      const res = await callModel({
        task: "nightly",
        tier: plan.tier,
        degraded: plan.degraded,
        agentId: agent.id,
        runId: null,
        createMessage: opts.createMessage ?? defaultCreateMessage,
        params: {
          max_tokens: 3500,
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                tonight: now.toFormat("cccc, LLLL d"),
                agent_first_name: agent.full_name.split(" ")[0],
                phase,
                collecting_until: phase === "collecting" ? revisionsFrom : null,
                days_until_changes: phase === "collecting" && revisionsFrom ? Math.round(DateTime.fromISO(revisionsFrom, { zone: agent.timezone }).diff(dayStart, "days").days) : 0,
                batch_rule: `the first ${REVISE_AFTER_DAYS} days of a batch are only for collecting results`,
                today: {
                  spend: money(numbers.spendCents),
                  daily_budget: money(numbers.budgetCents),
                  spend_vs_budget: numbers.budgetCents ? `${Math.round((numbers.spendCents / numbers.budgetCents) * 100)}%` : "n/a",
                  yesterday_spend: numbers.yesterdaySpendCents === null ? "n/a" : money(numbers.yesterdaySpendCents),
                  impressions: numbers.impressions,
                  link_clicks: numbers.linkClicks,
                  link_click_rate: numbers.ctr === null ? "n/a" : `${(numbers.ctr * 100).toFixed(2)}%`,
                  booked_calls_from_ads: numbers.bookedCalls,
                  spend_by_ad_today: live.ads.map((a) => ({ ad: a.name, spend: money(a.spendCents), impressions: a.impressions, link_clicks: a.linkClicks })),
                },
                batch: numbers.batch && { day: numbers.batch.day, of_days: numbers.batch.days, spent: money(numbers.batch.spentCents), budget: money(numbers.batch.budgetCents) },
                campaigns: snapshot.forModel.campaigns,
                creative_mix: snapshot.forModel.creative_mix,
                account_last_14_days: snapshot.forModel.account_last_14_days,
                platform_split_last_14_days: snapshot.forModel.platform_split_last_14_days,
                changes_today: changeList,
                running_experiments: experiments.data ?? [],
                market_research_ideas: snapshot.forModel.market_research_ideas,
                previous_thoughts: carried.map((x) => ({ id: x.id, text: x.text, kind: x.kind, status: x.status, nights: x.nights, since: x.since, last_note: x.note })),
                recent_nights: prior.map((r) => ({ date: r.local_date, spend: money(r.numbers.spendCents ?? 0), impressions: r.numbers.impressions, link_clicks: r.numbers.linkClicks, booked_calls: r.numbers.bookedCalls, headline: r.narrative?.headline })),
                page_findings: findings.map((f) => f.text),
                page_last_7_days: pageWeekLine(pageFacts),
                sync_note: syncNote || undefined,
              }),
            },
          ],
        },
      });
      costUsd = res.costUsd;
      const out = jsonOf<ModelOut>(res.message);
      if (out?.headline) {
        narrative = {
          headline: out.headline.slice(0, 120),
          happened: (out.happened ?? []).slice(0, 4).map((x) => x.slice(0, 240)),
          budget_read: (out.budget_read ?? "").slice(0, 400),
          next: (out.next ?? []).slice(0, 3).map((x) => x.slice(0, 240)),
          page_note: (out.page_note ?? "").slice(0, 300),
        };
        // While Migz can't act, nothing is "done"; a thought it claims to have finished goes back to ready
        const returned = (out.thoughts ?? []).map((x) => (phase === "collecting" && x.status === "done" ? { ...x, status: "ready" as const } : x));
        thoughts = mergeThoughts(carried, returned, localDate);
      }
    } catch (e) {
      console.error("nightly summary model step failed", agent.slug, e instanceof Error ? e.message : e);
    }
  }

  const content: NightlyContent = {
    dateLabel: now.toFormat("ccc, LLL d"),
    firstName: agent.full_name.split(" ")[0],
    phase,
    changesFrom: revisionsFrom ? DateTime.fromISO(revisionsFrom, { zone: agent.timezone }).toFormat("LLL d") : null,
    numbers,
    narrative,
    thoughts,
    changes: changeList.map((c) => c.title),
    findings,
    pageWeekLine: pageWeekLine(pageFacts),
  };

  if (findings.some((f: PageFinding) => f.key === "page_down")) {
    await alertAdmin(`*Booking page didn't load* for \`${agent.slug}\` at the nightly check.`).catch(() => {});
    await recordEventAlert({ agentId: agent.id, key: `page_down:${agent.id}`, severity: "critical", title: "Booking page didn't load", detail: `The nightly check couldn't load /${agent.slug}.` });
  }

  if (!save) return { status: "written", localDate, content, sent: false, costUsd };

  const { error } = await supabaseAdmin.from("nightly_summaries").insert({
    agent_id: agent.id,
    local_date: localDate,
    phase,
    numbers,
    thoughts,
    changes: changeList,
    page: { findings, facts: pageFacts },
    narrative,
    cost_usd: costUsd,
  });
  if (error?.code === "23505") return { status: "duplicate" };
  if (error) throw new Error(`Couldn't save tonight's summary: ${error.message}`);

  let sent = false;
  if (send) {
    sent = await notifyNightly(agent, content);
    if (sent) await supabaseAdmin.from("nightly_summaries").update({ slack_sent_at: new Date().toISOString() }).eq("agent_id", agent.id).eq("local_date", localDate);
  }
  return { status: "written", localDate, content, sent, costUsd };
}

/** Every hour (pg_cron): writes and sends the summary for each agent whose local clock has reached 9pm. */
export async function nightlyShift(deadlineMs: number) {
  const { data: agents } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("active", true)
    .neq("migz_mode", "off")
    .not("onboarding_completed_at", "is", null)
    .not("meta_ad_account_id", "is", null)
    .not("slug", "like", "e2e-%");
  const results: Record<string, string> = {};
  for (const agent of (agents ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    const local = DateTime.now().setZone(agent.timezone);
    const { count, error } = await supabaseAdmin
      .from("nightly_summaries")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agent.id)
      .eq("local_date", local.toISODate()!);
    if (error) {
      results[agent.slug] = "migration not run";
      continue;
    }
    if (!nightlyDue(local.hour, (count ?? 0) > 0)) {
      results[agent.slug] = "not due";
      continue;
    }
    try {
      const r = await writeNightly(agent);
      results[agent.slug] = r.status === "written" ? `written${r.sent ? " and sent" : " (not sent: no Slack)"}` : r.status === "skipped" ? `skipped: ${r.reason}` : "duplicate";
    } catch (e) {
      console.error("nightly summary failed", agent.slug, e instanceof Error ? e.message : e);
      results[agent.slug] = "failed";
    }
  }
  return results;
}
