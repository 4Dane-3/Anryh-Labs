import { isAnryhAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadPageAnalytics } from "@/lib/dashboard/page-analytics";

// Staff only: what visitors did on one agent's booking page during a campaign batch (?batch=<id>; the
// running one by default).
export async function GET(req: Request) {
  if (!(await isAnryhAdmin())) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent") ?? "";
  const { data: agent } = await supabaseAdmin.from("agents").select("id, timezone").eq("id", agentId).maybeSingle();
  if (!agent) return Response.json({ error: "No such agent" }, { status: 404 });
  return Response.json(await loadPageAnalytics(agent, url.searchParams.get("batch")), { headers: { "Cache-Control": "no-store" } });
}
