import "server-only";
import { checkCopy } from "@/lib/migz/guardrails";
import { callModel, jsonOf, planTier, textOf, type Budget, type CreateMessage } from "@/lib/migz/router";

// The clerk: Haiku's paperwork. A second, semantic compliance check on new ad copy (after the regex
// rules), and the plain-language wording for the activity feed and Slack.

type Ctx = { agentId: string; runId: string | null; budget: Budget; createMessage: CreateMessage };

const COPY_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["ok", "issues"],
  additionalProperties: false,
};

const COPY_SYSTEM = `You check life-insurance ad copy for Meta's Financial Products & Services rules and state insurance advertising rules before it runs. Flag only real problems: guarantees of approval, rates or savings; implying the reader is approved or qualifies; calling out personal attributes (age, health, finances, family status) in the second person; "lowest/cheapest" claims; implying a government program; anything misleading. Situational copy ("Your work policy ends when your job does.") is fine. Return ok=false only when there is a concrete problem, with one short issue per problem.`;

/** Regex rules first (free, certain), then Haiku for what regex can't see. Null = fine. */
export async function precheckCopy(texts: (string | null | undefined)[], ctx: Ctx) {
  const rule = checkCopy(...texts);
  if (rule) return rule;
  const plan = planTier("copy_check", ctx.budget);
  const clean = texts.filter((t): t is string => !!t && t.trim().length > 0);
  if (!plan || !clean.length) return null;
  const res = await callModel({
    task: "copy_check",
    tier: plan.tier,
    agentId: ctx.agentId,
    runId: ctx.runId,
    createMessage: ctx.createMessage,
    params: {
      max_tokens: 600,
      output_config: { effort: "low", format: { type: "json_schema", schema: COPY_SCHEMA } },
      system: [{ type: "text", text: COPY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: clean.map((t) => `- ${t}`).join("\n") }],
    },
  });
  const verdict = jsonOf<{ ok: boolean; issues: string[] }>(res.message);
  if (!verdict || verdict.ok) return null;
  return `The copy reviewer flagged: ${verdict.issues.join("; ")}. Rewrite it.`;
}

const FEED_SYSTEM = `You write for an independent life insurance agent whose Meta ads are run by Migz AI. Turn the review notes into a two-sentence summary they can read in five seconds: what changed and why, with the key numbers. Plain words, no jargon, no hype, no emoji.`;

/** Two-sentence run summary for the activity feed. Falls back to the operator's own words. */
export async function writeFeed(notes: string, ctx: Ctx) {
  const plan = planTier("feed", ctx.budget);
  if (!plan || !notes.trim()) return notes;
  const res = await callModel({
    task: "feed",
    tier: plan.tier,
    agentId: ctx.agentId,
    runId: ctx.runId,
    createMessage: ctx.createMessage,
    params: {
      max_tokens: 400,
      output_config: { effort: "low" },
      system: [{ type: "text", text: FEED_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: notes.slice(0, 6000) }],
    },
  });
  return textOf(res.message) || notes;
}

const SLACK_SYSTEM = `You write the weekly Slack report an independent life insurance agent gets about their Meta ads, run by Migz AI. Use Slack mrkdwn: a one-line headline, then short sections "What happened", "What Migz changed", "What's next". Keep every number from the notes, explain jargon in plain words, and keep it under 180 words. No emoji.`;

export async function writeWeeklySlack(notes: string, ctx: Ctx) {
  const plan = planTier("feed", ctx.budget);
  if (!plan) return notes;
  const res = await callModel({
    task: "feed",
    tier: plan.tier,
    agentId: ctx.agentId,
    runId: ctx.runId,
    createMessage: ctx.createMessage,
    params: {
      max_tokens: 900,
      output_config: { effort: "low" },
      system: [{ type: "text", text: SLACK_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: notes.slice(0, 8000) }],
    },
  });
  return textOf(res.message) || notes;
}
