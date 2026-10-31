import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { actionValue, getAdInsights, getAdSet, getPlacementInsights, keepToFacebookAndInstagram, reachesOtherApps, scheduleConversions } from "@/lib/meta/ads";
import { graphAll } from "@/lib/meta/graph";
import { pullFormLeads } from "@/lib/migz/leads";
import { refundRejectedVideo } from "@/lib/migz/creative-jobs";

export const LOOKBACK_DAYS = 14;

/**
 * Pulls the latest from Meta into our mirror: per-ad daily insights, ad set budget/status/learning,
 * and ad statuses. Then rolls up the dashboard's daily metrics and the ad-spend ledger.
 */
export async function syncAgent(agent: Agent) {
  const account = agent.meta_ad_account_id!;
  const { since, until } = await syncSpend(agent);

  // 1b. The same, split by placement, so placement decisions aren't blind
  const placements = await getPlacementInsights(account, since, until);
  if (placements.length) {
    const { error } = await supabaseAdmin.from("ad_placement_daily").upsert(
      placements.map((r) => ({
        agent_id: agent.id,
        meta_ad_id: r.ad_id,
        date: r.date_start,
        publisher_platform: r.publisher_platform,
        platform_position: r.platform_position,
        spend_cents: Math.round(Number(r.spend ?? 0) * 100),
        impressions: Number(r.impressions ?? 0),
        link_clicks: Number(r.inline_link_clicks ?? 0),
        video_3s_views: actionValue(r.actions, "video_view"),
        thruplays: actionValue(r.video_thruplay_watched_actions),
      })),
      { onConflict: "meta_ad_id,date,publisher_platform,platform_position" },
    );
    if (error) throw new Error(`Couldn't save placement insights: ${error.message}`);
  }

  // 2. Ad sets: budget, status, learning phase. Any running ad set that can reach the Audience Network
  // or Messenger (automatic placements switched on in Ads Manager, say) is put back on Facebook and
  // Instagram only: those placements spend the budget on accidental clicks that never book.
  const { data: adsets } = await supabaseAdmin
    .from("ad_sets")
    .select("id, meta_adset_id")
    .eq("agent_id", agent.id)
    .neq("status", "DELETED");
  for (const adset of adsets ?? []) {
    const live = await getAdSet(adset.meta_adset_id);
    if (live.status === "ACTIVE" && reachesOtherApps(live.targeting)) {
      try {
        await keepToFacebookAndInstagram(adset.meta_adset_id);
        await supabaseAdmin.from("ad_sets").update({ last_edited_at: new Date().toISOString() }).eq("id", adset.id);
        // Results with those placements aren't comparable: count from tomorrow, the first full day without them
        const tomorrow = DateTime.now().setZone(agent.timezone).plus({ days: 1 }).toISODate()!;
        if (!agent.results_from || agent.results_from < tomorrow)
          await supabaseAdmin.from("agents").update({ results_from: tomorrow }).eq("id", agent.id);
      } catch (e) {
        console.error("couldn't take an ad set off the Audience Network", adset.meta_adset_id, e instanceof Error ? e.message : e);
      }
    }
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
  const ads = await graphAll<{ id: string; status: string; effective_status: string; ad_review_feedback?: ReviewFeedback }>(`${account}/ads`, {
    fields: "id,status,effective_status,ad_review_feedback",
    limit: 500,
  });
  for (const ad of ads) {
    const status = ad.effective_status === "DISAPPROVED" ? "DISAPPROVED" : ad.status;
    // A rejected ad's paid video is refunded (idempotent, so every sync can check)
    if (status === "DISAPPROVED") {
      await refundRejectedVideo(agent.id, ad.id).catch((e) => console.error("refunding a rejected video failed", e));
      await logRejection(agent, ad.id, ad.ad_review_feedback).catch((e) => console.error("logging a rejection failed", e));
    }
    await supabaseAdmin
      .from("ads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("meta_ad_id", ad.id)
      .eq("agent_id", agent.id);
  }

  // 3b. Ads archived or deleted in Meta (by Migz, the agent or in Ads Manager) aren't in that listing:
  // mark them so they stop counting as live (scorecards, live-ad counts, the review)
  await markGoneAds(agent, account, new Set(ads.map((a) => a.id)));

  // 4. Instant-form leads the webhook missed (low–medium intent). Never fails the sync.
  if (agent.meta_lead_form_id)
    await pullFormLeads(agent).catch((e) => console.error("pulling form leads failed", e instanceof Error ? e.message : e));
}

type ReviewFeedback = { global?: Record<string, string>; placement_specific?: Record<string, Record<string, string>> };

/** Meta's reasons for rejecting an ad, as plain lines ("Personal attributes: …"). */
export function rejectionReasons(feedback: ReviewFeedback | undefined) {
  const lines = new Set<string>();
  for (const [k, v] of Object.entries(feedback?.global ?? {})) lines.add(`${k}: ${v}`.slice(0, 500));
  for (const per of Object.values(feedback?.placement_specific ?? {})) for (const [k, v] of Object.entries(per)) lines.add(`${k}: ${v}`.slice(0, 500));
  return [...lines];
}

/**
 * Keeps every rejected ad with Meta's reasons and the words on it (once per ad), so Migz learns which
 * phrasings fail on agent accounts. A no-op before the ad_rejections migration.
 */
async function logRejection(agent: Agent, metaAdId: string, feedback: ReviewFeedback | undefined) {
  const { data: seen, error } = await supabaseAdmin.from("ad_rejections").select("id").eq("meta_ad_id", metaAdId).maybeSingle();
  if (error || seen) return;
  const { data: ad } = await supabaseAdmin.from("ads").select("primary_text, headline, creatives(script)").eq("meta_ad_id", metaAdId).eq("agent_id", agent.id).maybeSingle();
  const script = (ad?.creatives as { script?: { hook_line?: string; overlay_lines?: string[] } | null } | null)?.script;
  await supabaseAdmin.from("ad_rejections").insert({
    agent_id: agent.id,
    meta_ad_id: metaAdId,
    reasons: rejectionReasons(feedback),
    primary_text: ad?.primary_text ?? null,
    headline: ad?.headline ?? null,
    hook_line: script?.hook_line ?? script?.overlay_lines?.join(" / ") ?? null,
  });
}

/**
 * 1. Per-ad daily insights (spend, clicks, video) for the last 14 days, and the dashboard's daily totals.
 * Read-only in Meta and cheap, so the hourly cron runs it between reviews to keep spend current.
 */
export async function syncSpend(agent: Agent) {
  const account = agent.meta_ad_account_id!;
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const since = today.minus({ days: LOOKBACK_DAYS - 1 }).toISODate()!;
  const until = today.toISODate()!;
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
        reach: Number(r.reach ?? 0),
        frequency: Number(r.frequency ?? 0),
        link_clicks: Number(r.inline_link_clicks ?? 0),
        video_plays: actionValue(r.video_play_actions),
        video_3s_views: actionValue(r.actions, "video_view"),
        thruplays: actionValue(r.video_thruplay_watched_actions),
        video_p25: actionValue(r.video_p25_watched_actions),
        video_p50: actionValue(r.video_p50_watched_actions),
        video_p75: actionValue(r.video_p75_watched_actions),
        video_p100: actionValue(r.video_p100_watched_actions),
        // Meta reports average watch time in seconds
        avg_watch_ms: Math.round(actionValue(r.video_avg_time_watched_actions) * 1000),
        landing_page_views: actionValue(r.actions, "landing_page_view"),
      })),
      { onConflict: "meta_ad_id,date" },
    );
    if (error) throw new Error(`Couldn't save insights: ${error.message}`);
  }

  await rollUp(agent, since, until);
  return { since, until };
}

/** Looks up our ads Meta's ad listing didn't return and records whether each was archived or deleted. */
async function markGoneAds(agent: Agent, account: string, listed: Set<string>) {
  const { data: ours } = await supabaseAdmin
    .from("ads")
    .select("meta_ad_id")
    .eq("agent_id", agent.id)
    .not("status", "in", "(ARCHIVED,DELETED)");
  const missing = (ours ?? []).map((a) => a.meta_ad_id).filter((id) => !listed.has(id));
  if (!missing.length) return 0;
  let found: Map<string, string>;
  try {
    const gone = await graphAll<{ id: string; effective_status: string }>(`${account}/ads`, {
      fields: "id,effective_status",
      filtering: JSON.stringify([
        { field: "id", operator: "IN", value: missing },
        { field: "effective_status", operator: "IN", value: ["ARCHIVED", "DELETED"] },
      ]),
      limit: 500,
    });
    found = new Map(gone.map((g) => [g.id, g.effective_status]));
  } catch (e) {
    // Never guess: if Meta can't say, leave the ads as they are until the next sync
    console.error("couldn't look up archived ads", e instanceof Error ? e.message : e);
    return 0;
  }
  const now = new Date().toISOString();
  for (const id of missing) {
    // Not in either listing: Meta has removed it entirely
    const status = found.get(id) === "ARCHIVED" ? "ARCHIVED" : "DELETED";
    await supabaseAdmin.from("ads").update({ status, updated_at: now }).eq("meta_ad_id", id).eq("agent_id", agent.id);
  }
  return missing.length;
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

  // Spend isn't taken from the wallet day by day: a batch sets its whole budget aside when it starts and
  // returns what it didn't spend when it ends (see setAsideBatch in dashboard/batches.ts)
}
