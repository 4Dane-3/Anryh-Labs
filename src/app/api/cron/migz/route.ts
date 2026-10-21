import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { isCronRequest } from "@/lib/cron-auth";
import { migzReadyFor } from "@/lib/integrations";
import { runMigz } from "@/lib/migz/agent";

export const maxDuration = 300;

const REVIEW_EVERY_HOURS = 6;
const PROPOSAL_TTL_HOURS = 48;

// Hourly (pg_cron). Reviews each Migz-enabled agent at most every 6 hours, oldest first, until the
// time budget is used; agents not reached this hour are picked up next hour.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const deadline = Date.now() + 240_000;

  // Proposals go stale as results change; expire ones the agent never acted on
  await supabaseAdmin
    .from("ad_actions")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("status", "proposed")
    .lt("created_at", new Date(Date.now() - PROPOSAL_TTL_HOURS * 3_600_000).toISOString());

  const dueBefore = new Date(Date.now() - REVIEW_EVERY_HOURS * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("active", true)
    .neq("migz_mode", "off")
    .not("meta_ad_account_id", "is", null)
    .or(`migz_last_run_at.is.null,migz_last_run_at.lt.${dueBefore}`)
    .order("migz_last_run_at", { ascending: true, nullsFirst: true })
    .limit(10);

  const results: Record<string, unknown> = {};
  for (const agent of (data ?? []) as Agent[]) {
    if (Date.now() > deadline) break;
    if (!migzReadyFor(agent)) {
      results[agent.slug] = "not configured";
      continue;
    }
    const run = await runMigz(agent, { trigger: "schedule" });
    results[agent.slug] = run.status;
  }
  return Response.json(results);
}
