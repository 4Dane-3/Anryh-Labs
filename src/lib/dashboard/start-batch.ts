import "server-only";
import { after } from "next/server";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { endDate } from "@/lib/campaign";
import { ensureBatchSetAside } from "@/lib/dashboard/batches";
import { runMigz } from "@/lib/migz/agent";

/**
 * Starts a batch: sets the daily spend and dates it implies, sets its money aside from the balance, then
 * Migz reviews in the background. A renewal (`continuing`) keeps the strategist's weekly memo on its own
 * cadence instead of re-running it, since the account isn't new.
 */
export async function activateBatch(
  agent: Agent,
  batchId: string,
  row: { days: number; daily_cents: number },
  mode: "approve" | "auto",
  opts: { continuing?: boolean } = {},
) {
  const today = DateTime.now().setZone(agent.timezone).toISODate()!;
  const ends = endDate(today, row.days);
  await supabaseAdmin
    .from("campaign_batches")
    .update({ status: "active", starts_on: today, ends_on: ends, started_at: new Date().toISOString(), applied_at: null })
    .eq("id", batchId);
  const { error } = await supabaseAdmin
    .from("agents")
    .update({
      daily_budget_cents: row.daily_cents,
      campaign_days: row.days,
      campaign_started_on: today,
      campaign_ends_on: ends,
      ads_paused: false,
      migz_mode: mode,
      migz_last_run_at: null,
      ...(opts.continuing ? {} : { migz_last_weekly_at: null }), // the strategist's memo runs on the first batch's first review
      migz_last_operator_at: null,
    })
    .eq("id", agent.id);
  if (error) throw new Error("Couldn't start the batch.");
  const fresh = (await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single()).data as Agent;
  // The batch's money comes out of the balance now (what it doesn't spend comes back when it ends)
  await ensureBatchSetAside(fresh);
  after(async () => {
    await runMigz(fresh, { trigger: "manual" }).catch((e) => console.error("batch review crashed", e));
  });
}
