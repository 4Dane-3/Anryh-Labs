import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { EventRow } from "@/lib/admin/page-analytics";

const PAGE = 1000; // the most rows the database returns per request, whatever .limit() asks for
const MAX_ROWS = 60_000;

/**
 * Every page event for an agent from `from` (and before `to`, when given), oldest first. Read a page at a
 * time: one request returns at most 1,000 rows, so a single query silently dropped the newest visits once an
 * agent had more than that. Same { data, error } shape as a Supabase query.
 */
export async function fetchPageEvents(agentId: string, from: string, to?: string | null): Promise<{ data: EventRow[] | null; error: unknown }> {
  const rows: EventRow[] = [];
  for (let start = 0; start < MAX_ROWS; start += PAGE) {
    let q = supabaseAdmin.from("page_events").select("session_id, name, meta, created_at").eq("agent_id", agentId).gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    const { data, error } = await q.order("created_at").order("id").range(start, start + PAGE - 1);
    if (error) return { data: start ? rows : null, error };
    rows.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { data: rows, error: null };
}
