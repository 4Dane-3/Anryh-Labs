import "server-only";

// ElevenLabs Agents over Twilio: one request places the call. The agent (prompt, voice on Flash v2.5, tools,
// post-call webhook) is configured in ElevenLabs; see docs/voice-agent.md.
//
// Safety while testing: outside production nothing is dialed unless VOICE_LIVE_CALLS=1, and even then every
// call goes to VOICE_TEST_NUMBER (your own phone), never the lead's number. Without it, dev logs the request
// and returns a simulated conversation id.

const API = "https://api.elevenlabs.io";

/** "agent_abc", even when what was pasted is "agent_abc/agent?branchId=…" or a whole URL from the ElevenLabs address bar. */
export function cleanElevenLabsId(raw: string | undefined, prefix: "agent_" | "phnum_") {
  const v = (raw ?? "").trim();
  const m = v.match(new RegExp(`${prefix}[A-Za-z0-9]+`));
  return m ? m[0] : v;
}

export const voiceConfig = () => ({
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  agentId: cleanElevenLabsId(process.env.ELEVENLABS_AGENT_ID, "agent_"),
  phoneNumberId: cleanElevenLabsId(process.env.ELEVENLABS_PHONE_NUMBER_ID, "phnum_"),
  webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
  // The post-job check-in agent (its own prompt and tools), on the same phone number
  checkinAgentId: cleanElevenLabsId(process.env.ELEVENLABS_CHECKIN_AGENT_ID, "agent_"),
});

/** Everything the voice agent needs is set (the per-account toggle is checked separately). */
export function voiceConfigured() {
  const c = voiceConfig();
  return !!(c.apiKey && c.agentId && c.phoneNumberId && c.webhookSecret);
}

/** Everything the post-job check-in call needs is set. */
export function checkinConfigured() {
  const c = voiceConfig();
  return !!(c.apiKey && c.checkinAgentId && c.phoneNumberId && c.webhookSecret);
}

const isProduction = () => process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";

/** Where a call really goes: the lead in production; in dev/preview only VOICE_TEST_NUMBER, or nowhere (simulated). */
export function dialTarget(leadNumber: string): { to: string; simulated: boolean } | { refused: string } {
  if (isProduction()) return { to: leadNumber, simulated: false };
  if (process.env.VOICE_LIVE_CALLS !== "1") return { to: leadNumber, simulated: true };
  const test = process.env.VOICE_TEST_NUMBER;
  if (!test) return { refused: "VOICE_LIVE_CALLS=1 outside production needs VOICE_TEST_NUMBER (your own phone); leads are never called while testing." };
  return { to: test, simulated: false };
}

export type OutboundResult =
  | { ok: true; conversationId: string | null; callSid: string | null; simulated: boolean }
  | { ok: false; error: string };

/** POST /v1/convai/twilio/outbound-call. Resolves when ElevenLabs has handed the call to Twilio. */
export async function placeOutboundCall(toNumber: string, dynamicVariables: Record<string, string>, opts: { agentId?: string } = {}): Promise<OutboundResult> {
  const c = voiceConfig();
  const target = dialTarget(toNumber);
  if ("refused" in target) return { ok: false, error: target.refused };
  const body = {
    agent_id: opts.agentId ?? c.agentId,
    agent_phone_number_id: c.phoneNumberId,
    to_number: target.to,
    conversation_initiation_client_data: { dynamic_variables: dynamicVariables },
  };
  if (target.simulated) {
    console.log("[voice] simulated outbound call (set VOICE_LIVE_CALLS=1 + VOICE_TEST_NUMBER to dial your own phone)", JSON.stringify({ ...body, agent_id: body.agent_id ? "set" : "MISSING" }));
    return { ok: true, conversationId: `sim_${dynamicVariables.lead_id ?? dynamicVariables.job_id}_${Date.now()}`, callSid: null, simulated: true };
  }
  try {
    const res = await fetch(`${API}/v1/convai/twilio/outbound-call`, {
      method: "POST",
      headers: { "xi-api-key": c.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string | null; callSid?: string | null; detail?: unknown };
    if (!res.ok || data.success === false) return { ok: false, error: `${res.status} ${data.message ?? JSON.stringify(data.detail ?? data).slice(0, 300)}` };
    return { ok: true, conversationId: data.conversation_id ?? null, callSid: data.callSid ?? null, simulated: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

let cachedCaller: Promise<string | null> | null = null;

/**
 * The number calls come from, for "We're calling you now from (xxx) xxx-xxxx": ELEVENLABS_CALLER_NUMBER, else
 * looked up once from ElevenLabs and kept for the life of the server (never on the dial path).
 */
export function callerNumber(): Promise<string | null> {
  if (process.env.ELEVENLABS_CALLER_NUMBER) return Promise.resolve(process.env.ELEVENLABS_CALLER_NUMBER);
  const c = voiceConfig();
  if (!c.apiKey || !c.phoneNumberId) return Promise.resolve(null);
  cachedCaller ??= fetch(`${API}/v1/convai/phone-numbers/${c.phoneNumberId}`, { headers: { "xi-api-key": c.apiKey }, signal: AbortSignal.timeout(3000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { phone_number?: string } | null) => d?.phone_number ?? null)
    .catch(() => null)
    .then((n) => {
      if (!n) cachedCaller = null; // try again next time
      return n;
    });
  return cachedCaller;
}
