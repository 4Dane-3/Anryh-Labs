import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pageAnalytics, type EventRow } from "@/lib/admin/page-analytics";

/**
 * One agent's page analytics over the last 7 or 30 days, from page_events (their page here, or their
 * partner-site page, which reports to the same place). { ready: false } before the page_events migration.
 */
export async function loadPageAnalytics(agent: { id: string; timezone: string }, days: 7 | 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("page_events")
    .select("session_id, name, meta, created_at")
    .eq("agent_id", agent.id)
    .gte("created_at", since)
    .order("created_at")
    .limit(20000);
  if (error) return { ready: false as const };
  return { ready: true as const, ...pageAnalytics((data ?? []) as EventRow[], days, agent.timezone) };
}
