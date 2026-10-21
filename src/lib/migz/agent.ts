import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { createAdSet, createCampaign, setStatus } from "@/lib/meta/ads";
import { isImageBrief, type AnyBrief, type CreativeBrief } from "@/lib/migz/brief";
import { applyPayload } from "@/lib/migz/executor";
import { MIGZ_SYSTEM_PROMPT, reviewMessage } from "@/lib/migz/prompt";
import { buildSnapshot, type Snapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
import { evaluate, MIGZ_TOOLS, type EvalContext } from "@/lib/migz/tools";

export const MIGZ_MODEL = "claude-opus-5-5";
const MAX_TURNS = 10;

export type CreateMessage = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

let client: Anthropic | null = null;
const defaultCreateMessage: CreateMessage = (params) => {
  client ??= new Anthropic();
  return client.beta.messages.create(params);
};

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
    .select("meta_ad_id, creative_id, ad_sets(meta_adset_id), creatives(script)")
    .eq("agent_id", agent.id)
    .not("creative_id", "is", null);

  const scriptedAds = new Map<string, { creative_id: string; script: CreativeBrief; meta_adset_id: string }>();
  for (const row of scripted ?? []) {
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
    openGenerations: snapshot.openGenerations,
    scriptedAds,
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

  if ((agent.ads_paused || lowBalance) && active.length) {
    for (const adset of active) await setStatus(adset.meta_adset_id, "PAUSED");
    await supabaseAdmin
      .from("ad_sets")
      .update({ status: "PAUSED", updated_at: new Date().toISOString() })
      .in("meta_adset_id", active.map((a) => a.meta_adset_id));
    await logAction(agent.id, {
      kind: "pause",
      title: agent.ads_paused ? "Paused your ads" : "Paused ads: balance is low",
      detail: agent.ads_paused
        ? "You turned ads off. They'll stay paused until you turn them back on."
        : `Your balance ($${(snapshot.balanceCents / 100).toFixed(2)}) can't cover a day at $${(agent.daily_budget_cents / 100).toFixed(2)}/day. Add funds to resume.`,
      status: "applied",
      tool: "system_pause",
      payload: { adset_ids: active.map((a) => a.meta_adset_id) },
      run_id: runId,
    });
    return "paused";
  }

  if (!agent.ads_paused && !lowBalance) {
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
  return agent.ads_paused || lowBalance ? "paused" : "ok";
}

/** First run: one campaign + one ad set targeting the agent's licensed states, funded at their daily budget. */
async function ensureCampaign(agent: Agent, runId: string) {
  if (!agent.licensed_states.length) throw new Error("Add the agent's licensed states before Migz can launch ads.");
  const account = agent.meta_ad_account_id!;
  const name = `Migz · Booked calls · ${agent.licensed_states.join(" ")}`;
  const campaignId = await createCampaign(account, name);
  await setStatus(campaignId, "ACTIVE"); // spends nothing until ads exist
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
    .insert({ agent_id: agent.id, meta_campaign_id: campaignId, name, status: "ACTIVE" })
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

/** Claude's review loop. Each tool call is validated, then proposed or applied depending on the agent's mode. */
async function decide(
  agent: Agent,
  snapshot: Snapshot,
  runId: string,
  createMessage: CreateMessage,
) {
  const mode = agent.migz_mode === "auto" ? "auto" : "approve";
  const ctx = await buildEvalContext(agent, snapshot);
  const messages: BetaMessageParam[] = [
    { role: "user", content: reviewMessage({ mode, snapshotJson: JSON.stringify(snapshot.forModel, null, 1) }) },
  ];
  const usage = { input: 0, output: 0 };
  let summary = "";
  let holds = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await createMessage({
      model: MIGZ_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a policy decline is retried server-side instead of ending the review
      output_config: { effort: "high" },
      system: [{ type: "text", text: MIGZ_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: MIGZ_TOOLS,
      messages,
    });
    usage.input += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
    usage.output += response.usage.output_tokens;

    if (response.stop_reason === "refusal") throw new Error("The model declined this review.");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) summary = text;

    // Only run tools on a clean tool_use stop: a max_tokens stop can carry a truncated tool input
    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) break;

    messages.push({ role: "assistant", content: response.content });
    const results: BetaToolResultBlockParam[] = [];

    for (const use of toolUses) {
      if (use.name === "hold" && holds++ >= 1) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Already recorded a hold this review." });
        continue;
      }
      const evaluated = evaluate(use.name, use.input, ctx);
      if (!evaluated.ok) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: evaluated.error });
        continue;
      }
      if (evaluated.payload.tool !== "hold") ctx.actionsThisRun++;
      if (["generate_video", "generate_image", "new_hook_variant"].includes(evaluated.payload.tool)) {
        ctx.generationsThisRun++;
        ctx.openGenerations++;
      }

      const base = {
        kind: evaluated.kind,
        title: evaluated.title,
        detail: evaluated.detail,
        tool: evaluated.payload.tool,
        payload: evaluated.payload,
        run_id: runId,
      };

      if (mode === "approve" && evaluated.payload.tool !== "hold") {
        await logAction(agent.id, { ...base, status: "proposed" });
        results.push({ type: "tool_result", tool_use_id: use.id, content: "Proposed. The agent will approve or reject it." });
        continue;
      }

      const actionId = await logAction(agent.id, { ...base, status: "applied" });
      const applied = await applyPayload(agent, evaluated.payload, actionId);
      await supabaseAdmin
        .from("ad_actions")
        .update(applied.ok ? { result: applied.result } : { status: "failed", result: { error: applied.error } })
        .eq("id", actionId);
      results.push(
        applied.ok
          ? { type: "tool_result", tool_use_id: use.id, content: `Done. ${JSON.stringify(applied.result)}` }
          : { type: "tool_result", tool_use_id: use.id, is_error: true, content: applied.error },
      );
    }

    messages.push({ role: "user", content: results });
  }

  return { summary, usage };
}

/** One full Migz review for an agent: sync, safety checks, setup, decisions. */
export async function runMigz(
  agent: Agent,
  opts: { trigger?: "schedule" | "manual"; createMessage?: CreateMessage } = {},
) {
  const { data: run } = await supabaseAdmin
    .from("migz_runs")
    .insert({ agent_id: agent.id, trigger: opts.trigger ?? "schedule", model: MIGZ_MODEL })
    .select("id")
    .single();
  const runId = run!.id as string;

  try {
    let snapshot = await buildSnapshot(agent);
    if (snapshot.hasCampaign) {
      await syncAgent(agent);
      snapshot = await buildSnapshot(agent);
    }

    const spend = await enforceSpendState(agent, snapshot, runId);
    if (spend === "paused") {
      await finish(runId, agent.id, { summary: "Ads are paused, so Migz made no changes." });
      return { runId, status: "paused" as const };
    }

    if (!snapshot.hasCampaign) {
      await ensureCampaign(agent, runId);
      snapshot = await buildSnapshot(agent);
    }

    const { summary, usage } = await decide(agent, snapshot, runId, opts.createMessage ?? defaultCreateMessage);
    await finish(runId, agent.id, { summary, input_tokens: usage.input, output_tokens: usage.output });
    return { runId, status: "succeeded" as const, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("migz_runs")
      .update({ status: "failed", error: message.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq("id", runId);
    await supabaseAdmin.from("agents").update({ migz_last_run_at: new Date().toISOString() }).eq("id", agent.id);
    return { runId, status: "failed" as const, error: message };
  }
}

async function finish(runId: string, agentId: string, fields: Record<string, unknown>) {
  const now = new Date().toISOString();
  await supabaseAdmin.from("migz_runs").update({ status: "succeeded", finished_at: now, ...fields }).eq("id", runId);
  await supabaseAdmin.from("agents").update({ migz_last_run_at: now }).eq("id", agentId);
}
