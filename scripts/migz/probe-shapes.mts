// Tiny real requests in the exact shapes Migz sends, to catch what simulated models can't:
// request validation on the live API. Costs a few cents at most.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { MIGZ_TOOLS } = await import("@/lib/migz/tools");
const { MODELS } = await import("@/lib/migz/models");
const ws = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {});
const sys = [{ type: "text" as const, text: "You are a test. Answer briefly.", cache_control: { type: "ephemeral" as const } }];
const msg = [{ role: "user" as const, content: "Reply with the word ok." }];
async function probe(label: string, run: () => Promise<unknown>) {
  try { await run(); console.log("OK  ", label); } catch (e) { console.log("FAIL", label, "→", String((e as Error).message).slice(0, 220)); }
}
await probe("operator: Sonnet + advisor(Opus) + tools + fallbacks default + effort", () =>
  client.beta.messages.create({
    model: MODELS.sonnet, max_tokens: 64, betas: ["advisor-tool-2026-03-01", "server-side-fallback-2026-07-01"], fallbacks: "default" as never,
    output_config: { effort: "medium" }, system: sys, messages: msg,
    tools: [...MIGZ_TOOLS, { type: "advisor_20260301", name: "advisor", model: MODELS.opus, max_uses: 3, max_tokens: 4000, caching: { type: "ephemeral", ttl: "5m" } }],
  }));
await probe("operator without fallbacks (retry path)", () =>
  client.beta.messages.create({
    model: MODELS.sonnet, max_tokens: 64, betas: ["advisor-tool-2026-03-01"], output_config: { effort: "medium" }, system: sys, messages: msg,
    tools: [...MIGZ_TOOLS, { type: "advisor_20260301", name: "advisor", model: MODELS.opus, max_uses: 3, max_tokens: 4000 }],
  }));
await probe("haiku: json_schema output (auditor/clerk shape)", () =>
  client.beta.messages.create({
    model: MODELS.haiku, max_tokens: 200, output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
    system: sys, messages: msg,
  }));
await probe("haiku: web_search_20250305 (scout)", () =>
  client.beta.messages.create({
    model: MODELS.haiku, max_tokens: 300, output_config: { effort: "low" },
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }], system: sys, messages: msg,
  }));
await probe("opus memo: json_schema, effort high, fallbacks", () =>
  client.beta.messages.create({
    model: MODELS.opus, max_tokens: 200, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as never,
    output_config: { effort: "high", format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
    system: sys, messages: msg,
  }));
await probe("sonnet vision: base64 image + json_schema", () =>
  client.beta.messages.create({
    model: MODELS.sonnet, max_tokens: 200, output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { seen: { type: "string" } }, required: ["seen"], additionalProperties: false } } },
    system: sys,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } }, { type: "text", text: "What colour is this?" }] }],
  }));
