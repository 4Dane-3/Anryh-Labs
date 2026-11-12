import { getCurrentAgent } from "@/lib/auth";
import { isPreviewUrl, isVoiceId, previewHeaders, previewUrl } from "@/lib/voice/ad-voices";

// A voice's preview clip, served from here: the dashboard only plays same-origin audio (COEP). The page sends the
// clip's link from the voice list (?src=), and only ElevenLabs' own preview clips are fetched; without one,
// it's looked up by voice id.
export async function GET(req: Request) {
  const agent = await getCurrentAgent();
  if (!agent) return new Response("Unauthorized", { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  const src = params.get("src");
  if (!isVoiceId(id)) return new Response("Bad voice", { status: 400 });
  const url = src && isPreviewUrl(src) ? src : await previewUrl(id);
  if (!url || !isPreviewUrl(url)) return new Response("No preview", { status: 404 });
  const res = await fetch(url, { headers: previewHeaders(url) });
  if (!res.ok || !res.body) return new Response("No preview", { status: 502 });
  return new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "private, max-age=86400" } });
}
