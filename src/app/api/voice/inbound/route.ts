import { validToolSecret } from "@/lib/voice/tools";
import { handleInboundInitiation } from "@/lib/voice/inbound";

// Inbound Emma's conversation-initiation webhook. ElevenLabs calls it while an incoming Twilio call is connecting
// (agent → Security → "Fetch conversation initiation data for inbound Twilio calls"), with caller_id, agent_id,
// called_number, call_sid and conversation_id. We answer with the roofer's preferences as dynamic variables. It
// carries the same `x-voice-secret` header as the tools. See docs/voice-agent.md, "Inbound Emma".
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 10;

export async function POST(req: Request) {
  if (!validToolSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, string>;
  try {
    return Response.json(await handleInboundInitiation(body));
  } catch (e) {
    console.error("[voice] inbound initiation failed", e);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
