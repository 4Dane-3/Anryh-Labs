import { getCurrentAgent } from "@/lib/auth";
import { loadPageAnalytics } from "@/lib/dashboard/page-analytics";

// The signed-in agent's own page analytics for a campaign batch (?batch=<id>; the running one by default).
// The Migz brain page shows them. Never another agent's.
export async function GET(req: Request) {
  const agent = await getCurrentAgent();
  if (!agent) return new Response("Unauthorized", { status: 401 });
  const batch = new URL(req.url).searchParams.get("batch");
  return Response.json(await loadPageAnalytics(agent, batch), { headers: { "Cache-Control": "no-store" } });
}
