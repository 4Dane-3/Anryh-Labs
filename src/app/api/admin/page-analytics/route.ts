import { isAnryhAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pageAnalytics, type EventRow } from "@/lib/admin/page-analytics";

// Staff only: what visitors did on one agent's booking page over the last 7 or 30 days.
export async function GET(req: Request) {
  if (!(await isAnryhAdmin())) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent") ?? "";
  const days = url.searchParams.get("days") === "30" ? 30 : 7;
  const { data: agent } = await supabaseAdmin.from("agents").select("id, timezone").eq("id", agentId).maybeSingle();
  if (!agent) return Response.json({ error: "No such agent" }, { status: 404 });

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("page_events")
    .select("session_id, name, meta, created_at")
    .eq("agent_id", agent.id)
    .gte("created_at", since)
    .order("created_at")
    .limit(20000);
  if (error) return Response.json({ ready: false }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ ready: true, ...pageAnalytics((data ?? []) as EventRow[], days, agent.timezone) }, { headers: { "Cache-Control": "no-store" } });
}
