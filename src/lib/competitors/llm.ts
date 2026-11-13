import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { callModel, defaultCreateMessage, jsonOf, type Task } from "@/lib/migz/router";
import type { ModelTier } from "@/lib/migz/models";

/** One structured call: the model answers in JSON matching `schema`. Null when it refuses or the JSON is bad. */
export async function ask<T>(input: { task: Task; tier: ModelTier; agentId: string | null; system: string; content: string | BetaContentBlockParam[]; schema: Record<string, unknown>; maxTokens?: number; effort?: "low" | "medium" | "high" }): Promise<T | null> {
  const res = await callModel({
    task: input.task,
    tier: input.tier,
    agentId: input.agentId,
    runId: null,
    createMessage: defaultCreateMessage,
    params: {
      max_tokens: input.maxTokens ?? 8000,
      output_config: { effort: input.effort ?? "medium", format: { type: "json_schema", schema: input.schema } },
      system: input.system,
      messages: [{ role: "user", content: input.content }],
    },
  });
  return jsonOf<T>(res.message);
}

/** A JSON schema object with every property required and nothing extra (what structured outputs need). */
export const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const arr = (items: unknown) => ({ type: "array", items });
export const str = { type: "string" } as const;
export const int = { type: "integer" } as const;
export const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
