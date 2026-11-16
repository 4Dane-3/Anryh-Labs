// Pushes Emma's speed-to-lead prompt (scripts/voice/emma-lead-prompt.md) and first message to the ElevenLabs agent,
// and removes any workflow (stages) attached to it, so the agent runs on this one prompt only. Tools are left alone.
//
//   node --env-file=.env.local scripts/voice/push-emma.mjs           dry run: shows what would change
//   node --env-file=.env.local scripts/voice/push-emma.mjs --apply   updates the agent (saves a backup first)
//
// The backup goes to .claude/emma-backups/ (not committed). To restore it, PATCH its conversation_config and workflow back.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIRST_MESSAGE =
  "{{greeting}}, this is Emma, the AI assistant for {{company_name}}, calling about the roof quote you just requested. This call may be recorded. I just have a few quick questions so the inspector comes prepared, then I'll get you booked. Got a quick minute?";

const here = dirname(fileURLToPath(import.meta.url));
const prompt = readFileSync(join(here, "emma-lead-prompt.md"), "utf8").trim();
const key = process.env.ELEVENLABS_API_KEY;
const agentId = (process.env.ELEVENLABS_AGENT_ID ?? "").match(/agent_[A-Za-z0-9]+/)?.[0];
if (!key || !agentId) throw new Error("Needs ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID (run with --env-file=.env.local).");

const url = `https://api.elevenlabs.io/v1/convai/agents/${agentId}`;
const headers = { "xi-api-key": key, "content-type": "application/json" };
const get = async () => {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`GET agent: ${r.status} ${await r.text()}`);
  return r.json();
};
const toolNames = (a) => (a.conversation_config?.agent?.prompt?.tools ?? []).map((t) => t.name).sort().join(",");
const stages = (a) => Object.values(a.workflow?.nodes ?? {}).filter((n) => n.type !== "start" && n.type !== "end").map((n) => n.label || n.type);

const before = await get();
const p = before.conversation_config.agent;
console.log(`Agent: ${before.name}`);
console.log(`Prompt: ${p.prompt.prompt === prompt ? "unchanged" : `${p.prompt.prompt.length} → ${prompt.length} characters`}`);
console.log(`First message: ${p.first_message === FIRST_MESSAGE ? "unchanged" : "updated"}`);
console.log(`Workflow stages: ${stages(before).join(" → ") || "none"}${stages(before).length ? " (will be removed)" : ""}`);
console.log(`Tools (left alone): ${toolNames(before)}`);

if (!process.argv.includes("--apply")) {
  console.log("\nDry run. Add --apply to update the agent.");
  process.exit(0);
}

const backups = join(here, "../../.claude/emma-backups");
mkdirSync(backups, { recursive: true });
const backup = join(backups, `lead-agent-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(before, null, 1));
console.log(`\nBackup: ${backup}`);

const res = await fetch(url, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    conversation_config: { agent: { first_message: FIRST_MESSAGE, prompt: { prompt } } },
    // ElevenLabs needs at least the start node; a start node with no edges means "just the agent's own prompt"
    workflow: { nodes: { start_node: { type: "start", position: { x: 0, y: 0 }, edge_order: [] } }, edges: {} },
  }),
});
if (!res.ok) throw new Error(`PATCH agent: ${res.status} ${await res.text()}`);

const after = await get();
const ok = {
  prompt: after.conversation_config.agent.prompt.prompt === prompt,
  firstMessage: after.conversation_config.agent.first_message === FIRST_MESSAGE,
  noStages: stages(after).length === 0,
  toolsKept: toolNames(after) === toolNames(before),
};
console.log(ok);
if (!Object.values(ok).every(Boolean)) {
  console.error(`Something didn't stick. Restore from ${backup} if the agent looks wrong.`);
  process.exit(1);
}
console.log("Emma updated.");
