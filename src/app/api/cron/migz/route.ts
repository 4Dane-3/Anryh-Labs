import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { isCronRequest } from "@/lib/cron-auth";
import { migzReadyFor } from "@/lib/integrations";
import { runMigz } from "@/lib/migz/agent";
import { renewBatches } from "@/lib/dashboard/renew";
import { syncSpend } from "@/lib/migz/sync";

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

  // "Keep going": batches that ended and were set to renew start again from the agent's balance, before reviews
  const renewals = await renewBatches(deadline - 60_000).catch((e) => {
    console.error("renewals failed", e);
    return {};
  });

  const dueBefore = new Date(Date.now() - REVIEW_EVERY_HOURS * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("active", true)
    .neq("migz_mode", "off")
    .not("meta_ad_account_id", "is", null)
    .not("onboarding_completed_at", "is", null) // setup finished: their first batch has started
    .or(`migz_last_run_at.is.null,migz_last_run_at.lt.${dueBefore}`)
    .order("migz_last_run_at", { ascending: true, nullsFirst: true })
    .limit(10);

  const results: Record<string, unknown> = Object.keys(renewals).length ? { renewals } : {};
  for (const agent of (data ?? []) as Agent[]) {
    if (Date.now() > deadline) break;
    if (!migzReadyFor(agent)) {
      results[agent.slug] = "not configured";
      continue;
    }
    const run = await runMigz(agent, { trigger: "schedule" });
    results[agent.slug] = run.status;
  }

  // Between reviews, keep each running batch's spend current on the dashboard (reads Meta, changes nothing)
  const reviewedBefore = new Date(Date.now() - 50 * 60_000).toISOString();
  const { data: running } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("active", true)
    .not("meta_ad_account_id", "is", null)
    .not("onboarding_completed_at", "is", null)
    .not("campaign_ends_on", "is", null)
    .lt("migz_last_run_at", reviewedBefore)
    .limit(25);
  const today = new Date().toISOString().slice(0, 10);
  for (const agent of (running ?? []) as Agent[]) {
    if (Date.now() > deadline + 30_000) break;
    if (!migzReadyFor(agent) || (agent.campaign_ends_on ?? "") < today) continue;
    await syncSpend(agent)
      .then(() => ((results[`${agent.slug} spend`] = "synced"), null))
      .catch((e) => ((results[`${agent.slug} spend`] = `failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`), null));
  }
  return Response.json(results);
}
