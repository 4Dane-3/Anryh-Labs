// Makes the two hair transplant clinic agents in ElevenLabs, copies of the roofing ones so they keep the same voice,
// LLM, tools (open_times, book_inspection, do_not_call), webhooks and settings:
//   Emma (Clinic)          speed-to-lead: calls a clinic's new consultation requests (ELEVENLABS_CLINIC_AGENT_ID)
//   Emma (Clinic Inbound)  answers a clinic's incoming calls (ELEVENLABS_CLINIC_INBOUND_AGENT_ID)
// and gives each the clinic's data collection fields (18+, what they want to talk about, timeline) in place of the
// roof ones. An agent whose env id is already set is only updated, never duplicated again.
//
//   node --env-file=.env.local scripts/voice/setup-clinic-agents.mjs           dry run
//   node --env-file=.env.local scripts/voice/setup-clinic-agents.mjs --apply   makes / updates them
//
// Then put the printed ids in .env.local and Vercel, and push the prompts:
//   node --env-file=.env.local scripts/voice/push-emma.mjs --clinic --apply
//   node --env-file=.env.local scripts/voice/push-emma.mjs --clinic-inbound --apply
const key = process.env.ELEVENLABS_API_KEY;
const id = (v) => (v ?? "").match(/agent_[A-Za-z0-9]+/)?.[0] ?? null;
const apply = process.argv.includes("--apply");
if (!key) throw new Error("Needs ELEVENLABS_API_KEY (run with --env-file=.env.local).");
const headers = { "xi-api-key": key, "content-type": "application/json" };
const api = async (method, path, body) => {
  const r = await fetch(`https://api.elevenlabs.io/v1/convai${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${(await r.text()).slice(0, 400)}`);
  return r.status === 204 ? null : r.json();
};

const str = (description) => ({ type: "string", description });
// What every clinic call collects. Kept from the source agent by name: outcome, callback_time, email
const CLINIC_FIELDS = {
  adult: str("Did the caller say they are 18 or older? Yes, No, or unknown."),
  interest: str("What they want to talk about at the consultation, in their words (for example: hair transplant, beard or eyebrow transplant, just exploring)."),
  timeline: str("When they're thinking of having it done, in their words (for example: next month, a few months, not sure)."),
};
const LEAD_OUTCOME = str(
  "How the call ended. Exactly one of: booked, not_qualified, callback, no_answer, do_not_call, voicemail. Use booked only if book_inspection succeeded. not_qualified if they're under 18. callback if they want a person to call them another time.",
);
const INBOUND_FIELDS = {
  caller_type: str("One of: new_customer, existing_customer, vendor, spam, other. new_customer for someone asking about a consultation, existing_customer for an existing patient, vendor for suppliers and other businesses."),
  outcome: str("One of: booked, message, transferred, not_qualified, callback, do_not_call. Use booked only if book_inspection succeeded. message when you took a message. not_qualified if they're under 18."),
  caller_name: str("The caller's name, if given."),
  message: str("The message for the team, in one or two sentences, if one was taken."),
};
const KEEP = ["callback_time", "email"];

const plans = [
  { name: "Emma (Clinic)", env: "ELEVENLABS_CLINIC_AGENT_ID", from: id(process.env.ELEVENLABS_AGENT_ID), fromEnv: "ELEVENLABS_AGENT_ID", fields: { outcome: LEAD_OUTCOME, ...CLINIC_FIELDS } },
  { name: "Emma (Clinic Inbound)", env: "ELEVENLABS_CLINIC_INBOUND_AGENT_ID", from: id(process.env.ELEVENLABS_INBOUND_AGENT_ID), fromEnv: "ELEVENLABS_INBOUND_AGENT_ID", fields: { ...INBOUND_FIELDS, ...CLINIC_FIELDS } },
];

for (const plan of plans) {
  let agentId = id(process.env[plan.env]);
  if (!agentId) {
    if (!plan.from) throw new Error(`${plan.fromEnv} isn't set, so there's nothing to copy for ${plan.name}.`);
    if (!apply) {
      console.log(`${plan.name}: would copy ${plan.from} (${plan.fromEnv})`);
      continue;
    }
    const made = await api("POST", `/agents/${plan.from}/duplicate`, { name: plan.name });
    agentId = made.agent_id;
    await api("PATCH", `/agents/${agentId}`, { name: plan.name });
    console.log(`${plan.name}: made ${agentId} (copy of ${plan.from})`);
  }

  const agent = await api("GET", `/agents/${agentId}`);
  const current = agent.platform_settings?.data_collection ?? {};
  // Keep the generic items the source had (by name), drop the roof ones, add the clinic's
  const kept = Object.fromEntries(Object.entries(current).filter(([k, v]) => KEEP.includes(v?.name ?? k)));
  const next = { ...kept, ...plan.fields };
  const names = (dc) => Object.entries(dc).map(([k, v]) => v?.name ?? k).sort();
  console.log(`${plan.name} (${agentId}): data collection ${names(current).join(", ") || "none"} → ${names(next).join(", ")}`);
  if (!apply) continue;
  await api("PATCH", `/agents/${agentId}`, { platform_settings: { data_collection: next } });
  const after = names((await api("GET", `/agents/${agentId}`)).platform_settings?.data_collection ?? {});
  const missing = names(next).filter((n) => !after.includes(n));
  if (missing.length) throw new Error(`${plan.name}: these fields didn't stick: ${missing.join(", ")}`);
  console.log(`  saved. ${plan.env}=${agentId}`);
}
if (!apply) console.log("\nDry run. Add --apply to make or update the agents.");
