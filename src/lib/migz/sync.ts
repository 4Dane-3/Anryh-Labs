import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getAdInsights, getAdSet, scheduleConversions } from "@/lib/meta/ads";
import { graphAll } from "@/lib/meta/graph";

export const LOOKBACK_DAYS = 14;

/**
 * Pulls the latest from Meta into our mirror: per-ad daily insights, ad set budget/status/learning,
 * and ad statuses. Then rolls up the dashboard's daily metrics and the ad-spend ledger.
 */
export async function syncAgent(agent: Agent) {
  const account = agent.meta_ad_account_id!;
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const since = today.minus({ days: LOOKBACK_DAYS - 1 }).toISODate()!;
  const until = today.toISODate()!;

  // 1. Per-ad daily insights
  const rows = await getAdInsights(account, since, until);
  if (rows.length) {
    const { error } = await supabaseAdmin.from("ad_insights_daily").upsert(
      rows.map((r) => ({
        agent_id: agent.id,
        meta_ad_id: r.ad_id,
        date: r.date_start,
        spend_cents: Math.round(Number(r.spend ?? 0) * 100),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        meta_conversions: scheduleConversions(r),
      })),
      { onConflict: "meta_ad_id,date" },
    );
    if (error) throw new Error(`Couldn't save insights: ${error.message}`);
  }

  // 2. Ad sets: budget, status, learning phase
  const { data: adsets } = await supabaseAdmin
    .from("ad_sets")
    .select("id, meta_adset_id")
    .eq("agent_id", agent.id)
    .neq("status", "DELETED");
  for (const adset of adsets ?? []) {
    const live = await getAdSet(adset.meta_adset_id);
    await supabaseAdmin
      .from("ad_sets")
      .update({
        status: live.status,
        daily_budget_cents: live.daily_budget ? Number(live.daily_budget) : undefined,
        learning_status: live.learning_stage_info?.status ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", adset.id);
  }

  // 3. Ad statuses (also catches ads paused or rejected outside Migz)
  const ads = await graphAll<{ id: string; status: string; effective_status: string }>(`${account}/ads`, {
    fields: "id,status,effective_status",
    limit: 500,
  });
  for (const ad of ads) {
    const status = ad.effective_status === "DISAPPROVED" ? "DISAPPROVED" : ad.status;
    await supabaseAdmin
      .from("ads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("meta_ad_id", ad.id)
      .eq("agent_id", agent.id);
  }

  await rollUp(agent, since, until);
}

/** Dashboard daily totals + one ad-spend ledger entry per day (idempotent via external_id). */
async function rollUp(agent: Agent, since: string, until: string) {
  const [{ data: insights }, { data: bookings }] = await Promise.all([
    supabaseAdmin
      .from("ad_insights_daily")
      .select("date, spend_cents, impressions, clicks")
      .eq("agent_id", agent.id)
      .gte("date", since)
      .lte("date", until),
    supabaseAdmin
      .from("bookings")
      .select("created_at, attribution")
      .eq("agent_id", agent.id)
      .gte("created_at", DateTime.fromISO(since, { zone: agent.timezone }).toUTC().toISO()!),
  ]);

  const days = new Map<string, { spend_cents: number; impressions: number; clicks: number; leads: number }>();
  for (const r of insights ?? []) {
    const d = days.get(r.date) ?? { spend_cents: 0, impressions: 0, clicks: 0, leads: 0 };
    d.spend_cents += r.spend_cents;
    d.impressions += r.impressions;
    d.clicks += r.clicks;
    days.set(r.date, d);
  }
  // Booked calls from ads = our own bookings that arrived with utm_source=meta
  for (const b of bookings ?? []) {
    if ((b.attribution as Record<string, string>)?.utm_source !== "meta") continue;
    const date = DateTime.fromISO(b.created_at).setZone(agent.timezone).toISODate()!;
    const d = days.get(date) ?? { spend_cents: 0, impressions: 0, clicks: 0, leads: 0 };
    d.leads += 1;
    days.set(date, d);
  }
  if (!days.size) return;

  await supabaseAdmin.from("ad_metrics_daily").upsert(
    [...days].map(([date, d]) => ({ agent_id: agent.id, date, ...d })),
    { onConflict: "agent_id,date" },
  );

  const spendDays = [...days].filter(([, d]) => d.spend_cents > 0);
  if (spendDays.length) {
    await supabaseAdmin.from("wallet_transactions").upsert(
      spendDays.map(([date, d]) => ({
        agent_id: agent.id,
        kind: "ad_spend",
        amount_cents: -d.spend_cents,
        status: "completed",
        description: `Meta ad spend · ${DateTime.fromISO(date).toFormat("LLL d")}`,
        external_id: `meta_spend:${agent.id}:${date}`,
        // End of that day, but never in the future (today's entry keeps updating as spend grows)
        created_at: DateTime.min(
          DateTime.fromISO(date, { zone: agent.timezone }).endOf("day"),
          DateTime.now(),
        ).toUTC().toISO(),
      })),
      { onConflict: "external_id" },
    );
  }
}
