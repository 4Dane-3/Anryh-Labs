import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { MIGZ_TOOLS } = await import("@/lib/migz/tools");
const { EXPERIMENT_TOOLS } = await import("@/lib/migz/experiments");
const { READ_TOOLS } = await import("@/lib/migz/team/tools");
const { diagnoseCreativeTool } = await import("@/lib/migz/vision");
const all = [...MIGZ_TOOLS, ...[...READ_TOOLS, ...EXPERIMENT_TOOLS, diagnoseCreativeTool].map((t) => t.def)];
const ws = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {});
const strictCount = (ts: typeof all) => ts.filter((t) => (t as { strict?: boolean }).strict).length;
async function probe(label: string, tools: typeof all) {
  try {
    await client.beta.messages.create({ model: "claude-sonnet-5-5", max_tokens: 16, tools, messages: [{ role: "user", content: "Reply with the word ok." }] });
    console.log(label, `strict=${strictCount(tools)}`, "OK");
  } catch (e) { console.log(label, `strict=${strictCount(tools)}`, "FAIL", String((e as Error).message).slice(0, 120)); }
}
await probe("all tools as shipped", all);
const orig = new Set(MIGZ_TOOLS.map((t) => t.name));
await probe("only the original 10 strict", all.map((t) => ({ ...t, strict: orig.has(t.name) && t.name !== "write_copy_variants" })));
await probe("no strict anywhere", all.map((t) => ({ ...t, strict: false })));
