import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { costUsd, MODELS, supportsFallbacks, tierOf, WEB_SEARCH_USD_PER_SEARCH, type ModelTier, type TokenUsage } from "@/lib/migz/models";

// Every model call goes through here: the task decides the tier, the agent's monthly model budget can
// push work to a cheaper tier, and each call (and each advisor consultation inside it) is logged with
// tokens, cost and latency.

export type CreateMessage = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

export type Task =
  | "audit" // Haiku: rank and explain the auditor's checks
  | "librarian" // Haiku: precedent from this agent's history
  | "scout" // Haiku + web search: what works in life-insurance ads
  | "swipe_traits" // Haiku: traits for a pasted swipe example
  | "copy_check" // Haiku: compliance pre-check on new copy
  | "feed" // Haiku: activity-feed and Slack wording
  | "creative_traits" // Sonnet vision: structured traits from frames
  | "operator" // Sonnet: runs the review with tools; Opus advises through the advisor tool
  | "memo" // Opus: weekly strategy memo
  | "batch_plan"; // Sonnet: recommends how to spend a new campaign batch

const TASK_TIER: Record<Task, ModelTier> = {
  audit: "haiku",
  librarian: "haiku",
  scout: "haiku",
  swipe_traits: "haiku",
  copy_check: "haiku",
  feed: "haiku",
  creative_traits: "sonnet",
  operator: "sonnet",
  memo: "opus",
  batch_plan: "sonnet",
};

export type Budget = { limitUsd: number; spentUsd: number; ratio: number };

export async function monthlyBudget(agentId: string | null, limitCents: number): Promise<Budget> {
  if (!agentId) return { limitUsd: Infinity, spentUsd: 0, ratio: 0 };
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data } = await supabaseAdmin
    .from("model_calls")
    .select("cost_usd")
    .eq("agent_id", agentId)
    .gte("created_at", monthStart.toISOString());
  const spentUsd = (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  const limitUsd = limitCents / 100;
  return { limitUsd, spentUsd, ratio: limitUsd > 0 ? spentUsd / limitUsd : spentUsd > 0 ? Infinity : 0 };
}

/**
 * The tier a task runs on given this month's model spend. Degrades instead of failing:
 *  - at 80% of the budget the market scout stops (it's the most optional work);
 *  - at 100%, drafting and the review itself move from Sonnet to Haiku, and the memo from Opus to
 *    Sonnet. The Opus advisor check on spend-affecting actions is never removed (it rides on the
 *    operator call as the advisor tool, whichever executor runs it).
 * Returns null when the task should be skipped.
 */
export function planTier(task: Task, budget: Budget): { tier: ModelTier; degraded: boolean } | null {
  const tier = TASK_TIER[task];
  if (task === "scout" && budget.ratio >= 0.8) return null;
  if (budget.ratio < 1) return { tier, degraded: false };
  if (tier === "sonnet") return { tier: "haiku", degraded: true };
  if (tier === "opus") return { tier: "sonnet", degraded: true };
  return { tier, degraded: false };
}

let client: Anthropic | null = null;
export const defaultCreateMessage: CreateMessage = (params) => {
  // Keys that aren't scoped to a workspace must name one on every request
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  return client.beta.messages.create(params);
};

type CallInput = {
  task: Task;
  tier: ModelTier;
  degraded?: boolean;
  agentId: string | null;
  runId: string | null;
  params: Omit<MessageCreateParamsNonStreaming, "model">;
  createMessage: CreateMessage;
};

export type CallResult = { message: BetaMessage; model: string; costUsd: number; usage: TokenUsage; advisorCalls: number };

/** Splits usage by the model that produced it (the advisor's Opus tokens arrive as their own iterations). */
function usageByModel(message: BetaMessage, fallbackModel: string) {
  const out = new Map<string, TokenUsage & { advisor: boolean }>();
  const add = (model: string, advisor: boolean, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) => {
    const key = `${model}|${advisor}`;
    const cur = out.get(key) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, advisor };
    cur.input += u.input_tokens;
    cur.output += u.output_tokens;
    cur.cacheRead += u.cache_read_input_tokens ?? 0;
    cur.cacheWrite += u.cache_creation_input_tokens ?? 0;
    out.set(key, cur);
  };
  const iterations = message.usage.iterations ?? [];
  if (iterations.length) {
    for (const it of iterations) {
      if (it.type === "message" || it.type === "fallback_message") add(("model" in it && it.model) || message.model || fallbackModel, false, it);
      else if (it.type === "advisor_message") add(it.model, true, it);
    }
  } else {
    add(message.model || fallbackModel, false, message.usage);
  }
  return out;
}

export async function callModel(input: CallInput): Promise<CallResult> {
  const model = MODELS[input.tier];
  const fallbacks = supportsFallbacks(input.tier);
  const extraBetas = (input.params as { betas?: string[] }).betas ?? [];
  const build = (withFallbacks: boolean) =>
    ({
      ...input.params,
      model,
      ...(withFallbacks
        ? { betas: [...new Set([...extraBetas, "server-side-fallback-2026-07-01"])], fallbacks: "default" }
        : extraBetas.length
          ? { betas: extraBetas }
          : {}),
    }) as MessageCreateParamsNonStreaming;

  const started = Date.now();
  let message: BetaMessage;
  try {
    message = await input.createMessage(build(fallbacks));
  } catch (e) {
    // If this beta combination isn't accepted (e.g. fallbacks alongside another beta tool), retry once
    // without fallbacks rather than failing the whole review.
    if (fallbacks && e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      message = await input.createMessage(build(false));
    } else throw e;
  }
  const latency = Date.now() - started;

  let total = 0;
  let advisorCalls = 0;
  const executorUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const rows = [];
  for (const [key, u] of usageByModel(message, model)) {
    const usedModel = key.split("|")[0];
    const cost = costUsd(usedModel, u, tierOf(usedModel));
    total += cost;
    if (u.advisor) advisorCalls++;
    else {
      executorUsage.input += u.input;
      executorUsage.output += u.output;
      executorUsage.cacheRead += u.cacheRead;
      executorUsage.cacheWrite += u.cacheWrite;
    }
    rows.push({
      agent_id: input.agentId,
      run_id: input.runId,
      task: u.advisor ? "advisor" : input.task,
      tier: tierOf(usedModel),
      model: usedModel,
      input_tokens: u.input,
      output_tokens: u.output,
      cache_read_tokens: u.cacheRead,
      cache_write_tokens: u.cacheWrite,
      cost_usd: cost,
      latency_ms: u.advisor ? 0 : latency,
      degraded: !u.advisor && !!input.degraded,
    });
  }
  const searches = message.usage.server_tool_use?.web_search_requests ?? 0;
  if (searches && rows[0]) {
    rows[0].cost_usd += searches * WEB_SEARCH_USD_PER_SEARCH;
    total += searches * WEB_SEARCH_USD_PER_SEARCH;
  }
  await supabaseAdmin.from("model_calls").insert(rows);
  return { message, model, costUsd: total, usage: executorUsage, advisorCalls };
}

/** Text of a response (all text blocks joined). */
export const textOf = (m: BetaMessage) =>
  m.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

/** Parses a structured-output (json_schema) response; null on refusal or bad JSON. */
export function jsonOf<T>(m: BetaMessage): T | null {
  if (m.stop_reason === "refusal") return null;
  try {
    return JSON.parse(textOf(m)) as T;
  } catch {
    return null;
  }
}
