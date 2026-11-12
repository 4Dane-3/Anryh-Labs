import { getCurrentAgent } from "@/lib/auth";
import { isVoiceId, previewUrl } from "@/lib/voice/ad-voices";

// A voice's preview clip, served from here: the dashboard only plays same-origin audio (COEP), and this only
// ever fetches ElevenLabs' own preview files.
export async function GET(req: Request) {
  const agent = await getCurrentAgent();
  if (!agent) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!isVoiceId(id)) return new Response("Bad voice", { status: 400 });
  const url = await previewUrl(id);
  if (!url || new URL(url).hostname !== "storage.googleapis.com") return new Response("No preview", { status: 404 });
  const res = await fetch(url);
  if (!res.ok || !res.body) return new Response("No preview", { status: 502 });
  return new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "private, max-age=86400" } });
}
