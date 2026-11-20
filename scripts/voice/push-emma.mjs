// Pushes Emma's speed-to-lead prompt (scripts/voice/emma-lead-prompt.md) and first message to the ElevenLabs agent,
// and removes any workflow (stages) attached to it, so the agent runs on this one prompt only. Tools are left alone.
//
//   node --env-file=.env.local scripts/voice/push-emma.mjs           dry run: shows what would change
//   node --env-file=.env.local scripts/voice/push-emma.mjs --apply   updates the agent (saves a backup first)
//
// With --inbound it pushes inbound Emma instead (scripts/voice/emma-inbound-prompt.md, ELEVENLABS_INBOUND_AGENT_ID).
// With --checkin it pushes the post-job check-in agent (scripts/voice/emma-checkin-prompt.md, ELEVENLABS_CHECKIN_AGENT_ID),
// keeping its own first message and workflow, and removes the old satisfaction-rating field (the call doesn't rate).
// With --clinic it pushes clinic Emma (scripts/voice/emma-clinic-prompt.md, ELEVENLABS_CLINIC_AGENT_ID): a copy of the
// lead agent with the same tools, for hair transplant clinics booking free consultations.
//
// Every agent is set to patient turn-taking, so Emma waits for people to finish instead of talking over a pause.
//
// The backup goes to .claude/emma-backups/ (not committed). To restore it, PATCH its conversation_config and workflow back.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const inbound = process.argv.includes("--inbound");
const checkin = process.argv.includes("--checkin");
const clinic = process.argv.includes("--clinic");
const kind = inbound ? "inbound" : checkin ? "checkin" : clinic ? "clinic" : "lead";
const FIRST_MESSAGE = {
  inbound: "Thanks for calling {{company_name}}, this is Emma, the AI assistant. This call may be recorded. How can I help you today?",
  lead: "{{greeting}}, this is Emma, the AI assistant for {{company_name}}, calling about the roof quote you just requested. This call may be recorded. I just have a few quick questions so the inspector comes prepared, then I'll get you booked. Got a quick minute?",
  clinic: "{{greeting}}, this is Emma, the AI assistant for {{company_name}}, calling about the consultation you just asked about. This call may be recorded. I just have a couple of quick questions, then I'll get you booked. Got a quick minute?",
  checkin: null, // keeps the check-in agent's own
}[kind];
const TURN_EAGERNESS = "patient";
const RATING_FIELD = "client_satisfaction_rating";

const here = dirname(fileURLToPath(import.meta.url));
const prompt = readFileSync(join(here, `emma-${kind}-prompt.md`), "utf8").trim();
const key = process.env.ELEVENLABS_API_KEY;
const envName = { inbound: "ELEVENLABS_INBOUND_AGENT_ID", checkin: "ELEVENLABS_CHECKIN_AGENT_ID", clinic: "ELEVENLABS_CLINIC_AGENT_ID", lead: "ELEVENLABS_AGENT_ID" }[kind];
const agentId = (process.env[envName] ?? "").match(/agent_[A-Za-z0-9]+/)?.[0];
if (!key || !agentId) throw new Error(`Needs ELEVENLABS_API_KEY and ${envName} (run with --env-file=.env.local).`);

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
const firstMessage = FIRST_MESSAGE ?? p.first_message;
const turn = before.conversation_config.turn ?? {};
const dataCollection = before.platform_settings?.data_collection ?? {};
const ratingField = checkin ? dataCollection[RATING_FIELD] : null;
console.log(`First message: ${p.first_message === firstMessage ? "unchanged" : "updated"}`);
console.log(`Turn eagerness: ${turn.turn_eagerness === TURN_EAGERNESS ? "unchanged" : `${turn.turn_eagerness} → ${TURN_EAGERNESS}`}`);
if (checkin) console.log(`Rating field (${RATING_FIELD}): ${ratingField ? "will be removed" : "none"}`);
if (!checkin) console.log(`Workflow stages: ${stages(before).join(" → ") || "none"}${stages(before).length ? " (will be removed)" : ""}`);
console.log(`Tools (left alone): ${toolNames(before)}`);

if (!process.argv.includes("--apply")) {
  console.log("\nDry run. Add --apply to update the agent.");
  process.exit(0);
}

const backups = join(here, "../../.claude/emma-backups");
mkdirSync(backups, { recursive: true });
const backup = join(backups, `${kind}-agent-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(before, null, 1));
console.log(`\nBackup: ${backup}`);

const res = await fetch(url, {
  method: "PATCH",
  headers,
  body: JSON.stringify({
    conversation_config: { agent: { first_message: firstMessage, prompt: { prompt } }, turn: { turn_eagerness: TURN_EAGERNESS } },
    ...(ratingField ? { platform_settings: { data_collection: Object.fromEntries(Object.entries(dataCollection).filter(([k]) => k !== RATING_FIELD)) } } : {}),
    // ElevenLabs needs at least the start node; a start node with no edges means "just the agent's own prompt"
    ...(checkin ? {} : { workflow: { nodes: { start_node: { type: "start", position: { x: 0, y: 0 }, edge_order: [] } }, edges: {} } }),
  }),
});
if (!res.ok) throw new Error(`PATCH agent: ${res.status} ${await res.text()}`);

const after = await get();
const ok = {
  prompt: after.conversation_config.agent.prompt.prompt === prompt,
  firstMessage: after.conversation_config.agent.first_message === firstMessage,
  patient: after.conversation_config.turn?.turn_eagerness === TURN_EAGERNESS,
  ...(checkin
    ? { ratingGone: !after.platform_settings?.data_collection?.[RATING_FIELD], otherFieldsKept: Object.keys(dataCollection).filter((k) => k !== RATING_FIELD).every((k) => after.platform_settings?.data_collection?.[k]) }
    : { noStages: stages(after).length === 0 }),
  toolsKept: toolNames(after) === toolNames(before),
};
console.log(ok);
if (!Object.values(ok).every(Boolean)) {
  console.error(`Something didn't stick. Restore from ${backup} if the agent looks wrong.`);
  process.exit(1);
}
console.log("Emma updated.");
