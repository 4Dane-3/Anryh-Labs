import { voiceConfig } from "@/lib/voice/elevenlabs";
import { handlePostCall, type PostCallPayload } from "@/lib/voice/post-call";
import { validElevenLabsSignature } from "@/lib/voice/rules";

// ElevenLabs' post-call webhook (Agents → Settings → Post-call webhook, with transcription + call initiation
// failure events). Signed with ELEVENLABS_WEBHOOK_SECRET; anything unsigned or stale is refused.
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 30;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validElevenLabsSignature(raw, req.headers.get("elevenlabs-signature"), voiceConfig().webhookSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  let payload: PostCallPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  try {
    const result = await handlePostCall(payload);
    return Response.json(result);
  } catch (e) {
    console.error("[voice] post-call webhook failed", e);
    // 500 so ElevenLabs retries
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
