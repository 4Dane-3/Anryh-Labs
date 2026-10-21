import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { createAdSet, createCampaign, setStatus } from "@/lib/meta/ads";
import { isImageBrief, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";
import { buildSnapshot, type Snapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
import { begin, emit } from "@/lib/migz/events";
import { campaignEnded } from "@/lib/campaign";
import { gateState, materialChanges, type GateState } from "@/lib/migz/gate";
import { MODELS } from "@/lib/migz/models";
import { runOperator, type ExtraTool } from "@/lib/migz/operator";
import { defaultCreateMessage, monthlyBudget, type Budget, type CreateMessage } from "@/lib/migz/router";
import { EXPERIMENT_TOOLS, experimentContext } from "@/lib/migz/experiments";
import { diagnoseCreativeTool, watchNewCreatives } from "@/lib/migz/vision";
import { runRoutines } from "@/lib/migz/routines";
import { audit } from "@/lib/migz/team/auditor";
import { writeFeed } from "@/lib/migz/team/clerk";
import { alertCriticalFindings, alertReviewFailed, nudgeProposals } from "@/lib/migz/slack";
import { runScout } from "@/lib/migz/team/scout";
import { READ_TOOLS } from "@/lib/migz/team/tools";
import type { EvalContext } from "@/lib/migz/tools";

export type { CreateMessage } from "@/lib/migz/router";

/**
 * MIGZ_TEST_MODE=1: everything is created for real (campaign, ad set, uploads, ads) but the campaign
 * stays paused, so nothing delivers or spends. Remove the flag and the next review switches it on.
 */
export const isTestMode = () => process.env.MIGZ_TEST_MODE === "1";

/** Operator tools and team context beyond the core: experiments, creative vision, pro routines. */
type Extension = {
  tools?: ExtraTool[];
  /** Adds to the team context the operator reads, and can report reasons to run (e.g. experiments ready). */
  context?: (agent: Agent, snapshot: Snapshot) => Promise<{ context: Record<string, unknown>; reasons: string[] }>;
  /** Runs once the gate decides a full review is due, before the operator starts. */
  beforeReview?: (agent: Agent, team: { runId: string; budget: Budget; createMessage: CreateMessage }) => Promise<unknown>;
};
const extensions: Extension[] = [
  { tools: EXPERIMENT_TOOLS, context: experimentContext },
  { tools: [diagnoseCreativeTool], beforeReview: watchNewCreatives },
];

async function logAction(agentId: string, row: Record<string, unknown>) {
  const { data } = await supabaseAdmin
    .from("ad_actions")
    .insert({ agent_id: agentId, ...row })
    .select("id")
    .single();
  return (data?.id as string) ?? null;
}

export async function buildEvalContext(agent: Agent, snapshot: Snapshot): Promise<EvalContext> {
  const { data: scripted } = await supabaseAdmin
    .from("ads")
    .select("meta_ad_id, creative_id, status, ad_sets(meta_adset_id), creatives(script, meta_video_id, meta_image_hash)")
    .eq("agent_id", agent.id)
    .not("creative_id", "is", null);

  const scriptedAds = new Map<string, { creative_id: string; script: CreativeBrief; meta_adset_id: string }>();
  const reusableAds = new Map<string, string>();
  for (const row of scripted ?? []) {
    const media = row.creatives as { meta_video_id?: string | null; meta_image_hash?: string | null } | null;
    const set = (row.ad_sets as { meta_adset_id?: string } | null)?.meta_adset_id;
    if (set && row.status === "ACTIVE" && (media?.meta_video_id || media?.meta_image_hash)) reusableAds.set(row.meta_ad_id, set);
    const script = (row.creatives as { script?: AnyBrief } | null)?.script;
    const adset = row.ad_sets as { meta_adset_id?: string } | null;
    // Only videos have a body to reuse with a new hook
    if (script && !isImageBrief(script) && adset?.meta_adset_id && row.creative_id) {
      scriptedAds.set(row.meta_ad_id, { creative_id: row.creative_id, script, meta_adset_id: adset.meta_adset_id });
    }
  }

  return {
    now: new Date(),
    dailyCapCents: agent.daily_budget_cents,
    adsets: snapshot.guardAdsets,
    actionsThisRun: 0,
    generationsThisRun: 0,
    videosThisRun: 0,
    testMode: isTestMode(),
    openGenerations: snapshot.openGenerations,
    scriptedAds,
    reusableAds,
    libraryCreativeIds: new Set(snapshot.forModel.creatives_not_running.map((c) => c.creative_id)),
  };
}

/**
 * Safety switch that runs before any AI decision: pause every ad set if the agent paused ads or the
 * balance can't cover a day of spend; resume what this switch paused once that's fixed.
 */
async function enforceSpendState(agent: Agent, snapshot: Snapshot, runId: string) {
  const active = snapshot.guardAdsets.filter((a) => a.status === "ACTIVE");
  const lowBalance = snapshot.balanceCents < agent.daily_budget_cents;
  // The agent chose how long the campaign runs; after its last day, ads stop
  const ended = campaignEnded(agent.campaign_ends_on, agent.timezone);

  if ((agent.ads_paused || lowBalance || ended) && active.length) {
    for (const adset of active) await setStatus(adset.meta_adset_id, "PAUSED");
    await supabaseAdmin
      .from("ad_sets")
      .update({ status: "PAUSED", updated_at: new Date().toISOString() })
      .in("meta_adset_id", active.map((a) => a.meta_adset_id));
    await logAction(agent.id, {
      kind: "pause",
      title: agent.ads_paused ? "Paused your ads" : ended ? "Your campaign has ended" : "Paused ads: balance is low",
      detail: agent.ads_paused
        ? "You turned ads off. They'll stay paused until you turn them back on."
        : ended
          ? `Your campaign was set to run until ${agent.campaign_ends_on}, so Migz paused your ads. To keep going, extend it on the Start here page.`
          : `Your balance ($${(snapshot.balanceCents / 100).toFixed(2)}) can't cover a day at $${(agent.daily_budget_cents / 100).toFixed(2)}/day. Add funds to resume.`,
      status: "applied",
      tool: "system_pause",
      payload: { adset_ids: active.map((a) => a.meta_adset_id) },
      run_id: runId,
    });
    return "paused";
  }

  if (!agent.ads_paused && !lowBalance && !ended) {
    const { data: last } = await supabaseAdmin
      .from("ad_actions")
      .select("tool, payload")
      .eq("agent_id", agent.id)
      .in("tool", ["system_pause", "system_resume"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.tool === "system_pause") {
      const ids = ((last.payload as { adset_ids?: string[] })?.adset_ids ?? []).filter((id) =>
        snapshot.guardAdsets.some((a) => a.meta_adset_id === id && a.status === "PAUSED"),
      );
      for (const id of ids) await setStatus(id, "ACTIVE");
      if (ids.length) {
        await supabaseAdmin.from("ad_sets").update({ status: "ACTIVE" }).in("meta_adset_id", ids);
      }
      await logAction(agent.id, {
        kind: "launch",
        title: "Resumed your ads",
        detail: "Ads are on and funded again, so delivery picked back up.",
        status: "applied",
        tool: "system_resume",
        payload: { adset_ids: ids },
        run_id: runId,
      });
      return "resumed";
    }
  }
  return agent.ads_paused || lowBalance || ended ? "paused" : "ok";
}

/** Keeps campaigns paused in test mode; switches them on the first review after test mode is removed. */
async function syncCampaignSwitch(agent: Agent, runId: string) {
  const want = isTestMode() ? "PAUSED" : "ACTIVE";
  const { data: campaigns } = await supabaseAdmin
    .from("ad_campaigns")
    .select("id, meta_campaign_id, status")
    .eq("agent_id", agent.id)
    .neq("status", want);
  for (const c of campaigns ?? []) {
    await setStatus(c.meta_campaign_id, want);
    await supabaseAdmin.from("ad_campaigns").update({ status: want, updated_at: new Date().toISOString() }).eq("id", c.id);
    // Going live for the first time: the campaign switch alone does nothing while its ad sets are still
    // paused, so turn them on too (unless the agent has paused their ads themselves)
    let resumed = 0;
    if (want === "ACTIVE" && !agent.ads_paused) {
      const { data: sets } = await supabaseAdmin.from("ad_sets").select("id, meta_adset_id").eq("campaign_id", c.id).eq("status", "PAUSED");
      for (const set of sets ?? []) {
        await setStatus(set.meta_adset_id, "ACTIVE");
        await supabaseAdmin.from("ad_sets").update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("id", set.id);
        resumed++;
      }
    }
    await logAction(agent.id, {
      kind: want === "ACTIVE" ? "launch" : "pause",
      title: want === "ACTIVE" ? "Turned your campaign on" : "Paused your campaign for testing",
      detail: want === "ACTIVE" ? `Test mode is off, so ads can now deliver${resumed ? ` (${resumed} ad set${resumed === 1 ? "" : "s"} switched on too)` : ""}.` : "Test mode is on: ads are built but won't deliver or spend.",
      status: "applied",
      tool: "system_test_mode",
      run_id: runId,
    });
  }
}

/** First run: one campaign + one ad set targeting the agent's licensed states, funded at their daily budget. */
async function ensureCampaign(agent: Agent, runId: string) {
  if (!agent.licensed_states.length) throw new Error("Add the agent's licensed states before Migz can launch ads.");
  const account = agent.meta_ad_account_id!;
  const name = `Migz · Booked calls · ${agent.licensed_states.join(" ")}`;
  const campaignId = await createCampaign(account, name);
  const campaignStatus = isTestMode() ? "PAUSED" : "ACTIVE";
  if (campaignStatus === "ACTIVE") await setStatus(campaignId, "ACTIVE"); // spends nothing until ads exist
  const adsetId = await createAdSet(account, {
    campaignId,
    name: `${agent.licensed_states.join(", ")} · adults 18+`,
    dailyBudgetCents: agent.daily_budget_cents,
    pixelId: process.env.META_PIXEL_ID!,
    states: agent.licensed_states,
    placements: [],
    status: "ACTIVE",
  });

  const { data: campaign } = await supabaseAdmin
    .from("ad_campaigns")
    .insert({ agent_id: agent.id, meta_campaign_id: campaignId, name, status: campaignStatus })
    .select("id")
    .single();
  await supabaseAdmin.from("ad_sets").insert({
    agent_id: agent.id,
    campaign_id: campaign!.id,
    meta_adset_id: adsetId,
    name: `${agent.licensed_states.join(", ")} · adults 18+`,
    status: "ACTIVE",
    daily_budget_cents: agent.daily_budget_cents,
  });
  await logAction(agent.id, {
    kind: "launch",
    title: "Set up your booked-calls campaign",
    detail: `Targets adults in ${agent.licensed_states.join(", ")} at $${(agent.daily_budget_cents / 100).toFixed(2)}/day, optimized for booked calls. Ads go live as creatives are approved.`,
    status: "applied",
    tool: "system_setup",
    run_id: runId,
  });
}

/**
 * One Migz cycle: sync (code) -> audit (code + Haiku) -> market research when due (Haiku) -> the
 * quiet-run gate (code) -> the review (Sonnet, advised by Opus) -> feed wording (Haiku).
 */
export async function runMigz(
  agent: Agent,
  opts: { trigger?: "schedule" | "manual"; createMessage?: CreateMessage } = {},
) {
  const trigger = opts.trigger ?? "schedule";
  const createMessage = opts.createMessage ?? defaultCreateMessage;
  const { data: run } = await supabaseAdmin
    .from("migz_runs")
    .insert({ agent_id: agent.id, trigger, model: MODELS.sonnet })
    .select("id")
    .single();
  const runId = run!.id as string;
  const cost = async () => {
    const { data } = await supabaseAdmin.from("model_calls").select("cost_usd").eq("run_id", runId);
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  };

  try {
    let snapshot = await buildSnapshot(agent);
    if (snapshot.hasCampaign) {
      const done = await begin({ agentId: agent.id, runId, step: "syncing", tier: "code", summary: "Pulling results from Meta" });
      await syncAgent(agent);
      snapshot = await buildSnapshot(agent);
      const t = snapshot.forModel.account_last_14_days;
      await done({ summary: `Synced 14 days: ${t.spend} spent, ${t.impressions} impressions, ${t.booked_calls} booked calls`, evidence: t });
    }

    await syncCampaignSwitch(agent, runId);
    const spend = await enforceSpendState(agent, snapshot, runId);
    if (spend === "paused") {
      await finish(runId, agent.id, { summary: "Ads are paused, so Migz made no changes." });
      await emit({ agentId: agent.id, runId, step: "finished", tier: "code", summary: "Ads are paused, so Migz made no changes." });
      return { runId, status: "paused" as const };
    }

    if (!snapshot.hasCampaign) {
      await ensureCampaign(agent, runId);
      snapshot = await buildSnapshot(agent);
    }

    const budget = await monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000);
    const team = { runId, budget, createMessage };
    const audited = await audit(agent, snapshot, team);
    await alertCriticalFindings(agent, audited.findings).catch(() => {});
    await runScout({ agentId: agent.id, ...team });
    const routines = await runRoutines(agent, snapshot, team);

    // Phase extensions (experiments, vision, routines) add context and reasons to run
    const teamContext: Record<string, unknown> = {
      open_audit_findings: audited.findings.slice(0, 10).map((f) => ({ check: f.check, severity: f.severity, summary: f.summary })),
      model_budget_this_month: `$${budget.spentUsd.toFixed(2)} of $${budget.limitUsd.toFixed(2)}`,
    };
    Object.assign(teamContext, routines.context);
    const extraReasons: string[] = [...routines.reasons];
    const extraTools: ExtraTool[] = [...READ_TOOLS];
    for (const ext of extensions) {
      if (ext.tools) extraTools.push(...ext.tools);
      if (ext.context) {
        const out = await ext.context(agent, snapshot);
        Object.assign(teamContext, out.context);
        extraReasons.push(...out.reasons);
      }
    }

    const reasons = materialChanges({
      trigger,
      snapshot,
      previous: (agent.migz_gate_state as GateState | null) ?? null,
      lastOperatorAt: agent.migz_last_operator_at ?? null,
      auditMaterial: audited.material,
      experimentsReady: 0,
      routinesDue: [],
    }).concat(extraReasons);

    if (!reasons.length) {
      await emit({ agentId: agent.id, runId, step: "skipped", tier: "code", summary: "skipped: quiet (nothing material changed since the last review)", evidence: gateState(snapshot) });
      await supabaseAdmin
        .from("migz_runs")
        .update({ status: "skipped", skipped_reason: "quiet", summary: "Nothing material changed, so Migz skipped the review.", finished_at: new Date().toISOString(), cost_usd: await cost() })
        .eq("id", runId);
      await supabaseAdmin.from("agents").update({ migz_last_run_at: new Date().toISOString() }).eq("id", agent.id);
      return { runId, status: "skipped" as const };
    }
    await emit({ agentId: agent.id, runId, step: "triaging", tier: "code", summary: `Full review: ${reasons.join("; ")}`, evidence: { reasons } });
    for (const ext of extensions) if (ext.beforeReview) await ext.beforeReview(agent, team);

    const ctx = await buildEvalContext(agent, snapshot);
    const result = await runOperator({ agent, snapshot, runId, budget, createMessage, ctx }, extraTools, { teamContext, reasons });
    const summary = result.summary ? await writeFeed(result.summary, { agentId: agent.id, runId, budget, createMessage }) : "";

    const now = new Date().toISOString();
    await finish(runId, agent.id, { summary, model: result.executor, input_tokens: result.usage.input, output_tokens: result.usage.output, cost_usd: await cost() });
    // Remember the account as this review left it, so its own changes don't trigger the next one
    const after = await buildSnapshot(agent);
    await supabaseAdmin.from("agents").update({ migz_last_operator_at: now, migz_gate_state: gateState(after) }).eq("id", agent.id);
    await emit({ agentId: agent.id, runId, step: "finished", tier: "code", summary: summary || "Review finished", evidence: { advisor_calls: result.advisorCalls, executor: result.executor, degraded: result.degraded } });
    await nudgeProposals(agent, runId).catch(() => {});
    return { runId, status: "succeeded" as const, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("migz_runs")
      .update({ status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString(), cost_usd: await cost() })
      .eq("id", runId);
    // Alert first (it checks recent events to avoid repeats), then record the failure
    await alertReviewFailed(agent, message, runId).catch(() => {});
    await emit({ agentId: agent.id, runId, step: "finished", tier: "code", summary: `Review failed: ${message.slice(0, 200)}` });
    // Failed reviews don't count toward the 6-hour schedule or the 1-hour "Review now" cooldown,
    // so a fixed setup problem (bad key, missing asset) can be retried right away.
    return { runId, status: "failed" as const, error: message };
  }
}

async function finish(runId: string, agentId: string, fields: Record<string, unknown>) {
  const now = new Date().toISOString();
  await supabaseAdmin.from("migz_runs").update({ status: "succeeded", finished_at: now, ...fields }).eq("id", runId);
  await supabaseAdmin.from("agents").update({ migz_last_run_at: now }).eq("id", agentId);
}
