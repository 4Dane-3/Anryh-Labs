import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { applyPayload } from "@/lib/migz/executor";
import { emit, type Step } from "@/lib/migz/events";
import { MODELS } from "@/lib/migz/models";
import { MIGZ_SYSTEM_PROMPT, reviewMessage } from "@/lib/migz/prompt";
import { callModel, planTier, textOf, type Budget, type CreateMessage } from "@/lib/migz/router";
import type { Snapshot } from "@/lib/migz/snapshot";
import { precheckCopy } from "@/lib/migz/team/clerk";
import { evaluate, MIGZ_TOOLS, type ActionPayload, type EvalContext } from "@/lib/migz/tools";
import { checkNotCopied } from "@/lib/migz/guardrails";

// The operator: Sonnet runs the review loop with tools; Opus is on call through the advisor tool and
// must be consulted (in code, not just in the prompt) before any spend-affecting action.

const MAX_TURNS = 10;
export const ADVISOR_BETA = "advisor-tool-2026-03-01";
export const ADVISOR_MAX_USES = 3;

export type OperatorEnv = {
  agent: Agent;
  snapshot: Snapshot;
  runId: string;
  budget: Budget;
  createMessage: CreateMessage;
  ctx: EvalContext;
};

export type ToolOutcome = { content: string; isError?: boolean };

/** Tools that don't go through evaluate()/applyPayload: read-only lookups and the experiment ledger. */
export type ExtraTool = {
  def: Anthropic.Beta.BetaTool;
  /** True when the call can change spend (so the advisor must have been consulted first). */
  spend: (input: Record<string, unknown>) => boolean;
  step: Step;
  run: (input: Record<string, unknown>, env: OperatorEnv) => Promise<ToolOutcome>;
};

const COPY_TOOLS = new Set(["generate_video", "generate_image", "generate_carousel", "new_hook_variant", "launch_creative", "write_copy_variants"]);
const GENERATION_TOOLS = ["generate_video", "generate_image", "generate_carousel", "new_hook_variant"];

/** Whether a validated action can change what Meta spends or shows. */
export function affectsSpend(payload: ActionPayload) {
  switch (payload.tool) {
    case "hold":
    case "set_quote_option": // the booking page, not spend
      return false;
    case "generate_video":
    case "generate_image":
      return payload.launch_adset_id !== null; // straight into an ad set = a launch
    default:
      return true;
  }
}

function copyOf(payload: ActionPayload): string[] {
  if ("brief" in payload) {
    const b = payload.brief as unknown as Record<string, unknown>;
    const cards = (b.cards as { overlay_lines: string[]; headline: string }[] | undefined) ?? [];
    return [b.hook_line, b.primary_text, b.headline, b.voiceover, ...((b.overlay_lines as string[]) ?? []), b.button_text, ...cards.flatMap((c) => [...c.overlay_lines, c.headline])].filter(
      (x): x is string => typeof x === "string",
    );
  }
  if (payload.tool === "launch_creative") return [payload.primary_text, payload.headline];
  if (payload.tool === "write_copy_variants") return payload.variants.flatMap((v) => [v.primary_text, v.headline]);
  return [];
}

async function logAction(agentId: string, row: Record<string, unknown>) {
  const { data } = await supabaseAdmin.from("ad_actions").insert({ agent_id: agentId, ...row }).select("id").single();
  return (data?.id as string) ?? null;
}

/** Walks a response in order and reports which tool_use ids came after a successful advisor consultation. */
export function advisedToolUses(content: BetaContentBlock[], alreadyAdvised: boolean) {
  let advised = alreadyAdvised;
  const consultations: { stopReason: string | null }[] = [];
  const advisedIds = new Set<string>();
  for (const block of content) {
    if (block.type === "advisor_tool_result") {
      const c = block.content;
      if (c.type === "advisor_redacted_result" || c.type === "advisor_result") {
        advised = true;
        consultations.push({ stopReason: c.stop_reason });
      }
    } else if (block.type === "tool_use" && advised) advisedIds.add(block.id);
  }
  return { advised, advisedIds, consultations };
}

export async function runOperator(
  env: OperatorEnv,
  extras: ExtraTool[],
  opts: { teamContext: Record<string, unknown>; reasons: string[]; producing?: boolean },
) {
  const { agent, snapshot, runId } = env;
  const mode = agent.migz_mode === "auto" ? "auto" : "approve";
  const plan = planTier("operator", env.budget)!;
  const extraByName = new Map(extras.map((t) => [t.def.name, t]));
  // Outside batch setup the generators aren't offered at all (checkGeneration also refuses them)
  const producing = opts.producing ?? true;
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...(producing ? MIGZ_TOOLS : MIGZ_TOOLS.filter((t) => !GENERATION_TOOLS.includes(t.name))),
    ...extras.map((t) => t.def),
    {
      type: "advisor_20260301",
      name: "advisor",
      model: MODELS.opus,
      max_uses: ADVISOR_MAX_USES,
      max_tokens: 4000,
      caching: { type: "ephemeral", ttl: "5m" },
    },
  ];
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: reviewMessage({
        mode,
        producing,
        refreshAdsets: env.ctx.refreshAdsets,
        today: new Date().toLocaleDateString("en-US", { timeZone: agent.timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" }),
        snapshotJson: JSON.stringify(snapshot.forModel, null, 1),
        contextJson: JSON.stringify(opts.teamContext, null, 1),
        reasons: opts.reasons,
      }),
    },
  ];

  const usage = { input: 0, output: 0, cost: 0 };
  let summary = "";
  let holds = 0;
  let advised = false;
  let advisorCalls = 0;
  const { data: swipes } = await supabaseAdmin
    .from("swipe_files")
    .select("notes")
    .or(`agent_id.is.null,agent_id.eq.${agent.id}`)
    .limit(200);
  const swipeTexts = (swipes ?? []).map((s) => s.notes ?? "").filter(Boolean);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await callModel({
      task: "operator",
      tier: plan.tier,
      degraded: plan.degraded,
      agentId: agent.id,
      runId,
      createMessage: env.createMessage,
      params: {
        max_tokens: 16000,
        betas: [ADVISOR_BETA],
        output_config: { effort: "medium" },
        system: [{ type: "text", text: MIGZ_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      },
    });
    const response = res.message;
    usage.input += res.usage.input + res.usage.cacheRead;
    usage.output += res.usage.output;
    usage.cost += res.costUsd;

    if (response.stop_reason === "refusal") throw new Error("The model declined this review.");
    const text = textOf(response);
    if (text) summary = text;

    const check = advisedToolUses(response.content, advised);
    for (const c of check.consultations) {
      advisorCalls++;
      // The advice itself is encrypted (Opus 5.5 advisor): we log that it happened, never its content
      await emit({
        agentId: agent.id,
        runId,
        step: "advising",
        tier: "opus",
        model: MODELS.opus,
        summary: `Consulted the advisor (${advisorCalls} of ${ADVISOR_MAX_USES})`,
        evidence: { stop_reason: c.stopReason, executor: res.model },
      });
    }
    advised = check.advised;

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    // pause_turn: a server tool (the advisor) paused the turn; send the content back to continue
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    // Only run tools on a clean tool_use stop: a max_tokens stop can carry a truncated tool input
    if (response.stop_reason !== "tool_use" || !toolUses.length) break;

    messages.push({ role: "assistant", content: response.content });
    const results: BetaToolResultBlockParam[] = [];
    const reply = (id: string, out: ToolOutcome) =>
      results.push({ type: "tool_result", tool_use_id: id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    const needsAdvice = (use: BetaToolUseBlock) =>
      reply(use.id, {
        isError: true,
        content: "Consult the advisor before this action: it affects spend. Call the advisor with your plan, then make the call again.",
      });

    for (const use of toolUses) {
      const input = (use.input ?? {}) as Record<string, unknown>;

      const extra = extraByName.get(use.name);
      if (extra) {
        if (extra.spend(input) && !check.advisedIds.has(use.id)) {
          await emit({ agentId: agent.id, runId, step: "checking", tier: "code", summary: `Blocked ${use.name}: advisor not consulted yet`, evidence: { tool: use.name } });
          needsAdvice(use);
          continue;
        }
        reply(use.id, await extra.run(input, env));
        continue;
      }

      if (use.name === "hold" && holds++ >= 1) {
        reply(use.id, { isError: true, content: "Already recorded a hold this review." });
        continue;
      }
      const evaluated = evaluate(use.name, input, env.ctx);
      if (!evaluated.ok) {
        await emit({ agentId: agent.id, runId, step: "checking", tier: "code", summary: `Guardrail stopped ${use.name}: ${evaluated.error.slice(0, 160)}`, evidence: { tool: use.name } });
        reply(use.id, { isError: true, content: evaluated.error });
        continue;
      }
      if (affectsSpend(evaluated.payload) && !check.advisedIds.has(use.id)) {
        await emit({ agentId: agent.id, runId, step: "checking", tier: "code", summary: `Blocked ${use.name}: advisor not consulted yet`, evidence: { tool: use.name } });
        needsAdvice(use);
        continue;
      }
      if (COPY_TOOLS.has(evaluated.payload.tool)) {
        const lifted = checkNotCopied(copyOf(evaluated.payload), swipeTexts);
        if (lifted) {
          await emit({ agentId: agent.id, runId, step: "checking", tier: "code", summary: `Guardrail stopped ${use.name}: copy lifted from a market example` });
          reply(use.id, { isError: true, content: lifted });
          continue;
        }
        const issue = await precheckCopy(copyOf(evaluated.payload), { agentId: agent.id, runId, budget: env.budget, createMessage: env.createMessage });
        if (issue) {
          await emit({ agentId: agent.id, runId, step: "checking", tier: "haiku", model: MODELS.haiku, summary: `Copy check sent back "${evaluated.title}"`, evidence: { issue } });
          reply(use.id, { isError: true, content: issue });
          continue;
        }
      }

      if (evaluated.payload.tool !== "hold") env.ctx.actionsThisRun++;
      if (GENERATION_TOOLS.includes(evaluated.payload.tool)) {
        env.ctx.generationsThisRun++;
        env.ctx.openGenerations++;
        if (evaluated.payload.tool === "generate_video" || evaluated.payload.tool === "new_hook_variant") env.ctx.videosThisRun = (env.ctx.videosThisRun ?? 0) + 1;
      }
      const base = { kind: evaluated.kind, title: evaluated.title, detail: evaluated.detail, tool: evaluated.payload.tool, payload: evaluated.payload, run_id: runId };
      const creative = GENERATION_TOOLS.includes(evaluated.payload.tool);

      if (mode === "approve" && evaluated.payload.tool !== "hold") {
        await logAction(agent.id, { ...base, status: "proposed" });
        await emit({ agentId: agent.id, runId, step: creative ? "drafting" : "acting", tier: creative ? "higgsfield" : "code", summary: `Proposed: ${evaluated.title}`, evidence: { tool: evaluated.payload.tool, reason: evaluated.detail } });
        reply(use.id, { content: "Proposed. The agent will approve or reject it." });
        continue;
      }

      const actionId = await logAction(agent.id, { ...base, status: "applied" });
      const applied = await applyPayload(agent, evaluated.payload, actionId, { runId, title: evaluated.title });
      // Later calls in this review check against the new state
      if (applied.ok && evaluated.payload.tool === "set_quote_option") env.ctx.quoteMode = evaluated.payload.mode;
      if (applied.ok && evaluated.payload.tool === "set_optimization_event") {
        const { adset_id, event } = evaluated.payload;
        env.ctx.adsets = env.ctx.adsets.map((s) => (s.meta_adset_id === adset_id ? { ...s, optimization_event: event, last_edited_at: new Date().toISOString() } : s));
      }
      // Budget and pause checks later in this review (the daily cap, "keep one live ad") must see these too
      if (applied.ok && evaluated.payload.tool === "adjust_daily_budget") {
        const { adset_id, cents } = evaluated.payload;
        env.ctx.adsets = env.ctx.adsets.map((s) => (s.meta_adset_id === adset_id ? { ...s, daily_budget_cents: cents, last_edited_at: new Date().toISOString() } : s));
      }
      if (applied.ok && (evaluated.payload.tool === "pause_ad" || evaluated.payload.tool === "resume_ad")) {
        const { ad_id } = evaluated.payload;
        const status = evaluated.payload.tool === "pause_ad" ? "PAUSED" : "ACTIVE";
        env.ctx.adsets = env.ctx.adsets.map((s) => ({ ...s, ads: s.ads.map((a) => (a.meta_ad_id === ad_id ? { ...a, status } : a)) }));
      }
      await supabaseAdmin
        .from("ad_actions")
        .update(applied.ok ? { result: applied.result } : { status: "failed", result: { error: applied.error } })
        .eq("id", actionId);
      // Meta changes and generations log their own live steps; a hold (or a failure) is recorded here
      if (!applied.ok || evaluated.payload.tool === "hold" || evaluated.payload.tool === "launch_creative")
        await emit({
          agentId: agent.id,
          runId,
          step: creative ? "drafting" : "acting",
          tier: creative ? "higgsfield" : "code",
          summary: applied.ok ? evaluated.title : `Failed: ${evaluated.title}`,
          evidence: { tool: evaluated.payload.tool, reason: evaluated.detail, ...(applied.ok ? {} : { error: applied.error }) },
        });
      reply(use.id, applied.ok ? { content: `Done. ${JSON.stringify(applied.result)}` } : { isError: true, content: applied.error });
    }

    messages.push({ role: "user", content: results });
  }

  return { summary, usage, advisorCalls, executor: MODELS[plan.tier], degraded: plan.degraded };
}
