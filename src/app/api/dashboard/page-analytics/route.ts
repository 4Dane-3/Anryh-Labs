import { getCurrentAgent } from "@/lib/auth";
import { loadPageAnalytics } from "@/lib/dashboard/page-analytics";

// The signed-in agent's own page analytics (the Migz brain page shows them). Never another agent's.
export async function GET(req: Request) {
  const agent = await getCurrentAgent();
  if (!agent) return new Response("Unauthorized", { status: 401 });
  const days = new URL(req.url).searchParams.get("days") === "30" ? 30 : 7;
  return Response.json(await loadPageAnalytics(agent, days), { headers: { "Cache-Control": "no-store" } });
}
