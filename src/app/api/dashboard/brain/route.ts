import { getCurrentAgent } from "@/lib/auth";
import { getBrainLive } from "@/lib/migz/brain";

// Polled by the Brain page and the Overview widget: run status plus events after ?after=<id>.
export async function GET(req: Request) {
  const agent = await getCurrentAgent();
  if (!agent) return new Response("Unauthorized", { status: 401 });
  const after = Number(new URL(req.url).searchParams.get("after")) || undefined;
  return Response.json(await getBrainLive(agent, after), { headers: { "Cache-Control": "no-store" } });
}
