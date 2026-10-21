import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getBalanceCents } from "@/lib/dashboard/queries";
import type { AdSetState } from "@/lib/migz/guardrails";
import { LOOKBACK_DAYS } from "@/lib/migz/sync";
import { briefLabel, isImageBrief, type AnyBrief } from "@/lib/migz/brief";

type Window = { spend_cents: number; impressions: number; clicks: number; booked_calls: number };

const emptyWindow = (): Window => ({ spend_cents: 0, impressions: 0, clicks: 0, booked_calls: 0 });

function summarize(w: Window) {
  return {
    spend: `$${(w.spend_cents / 100).toFixed(2)}`,
    impressions: w.impressions,
    clicks: w.clicks,
    ctr: w.impressions ? `${((w.clicks / w.impressions) * 100).toFixed(2)}%` : "n/a",
    booked_calls: w.booked_calls,
    cost_per_booked_call: w.booked_calls ? `$${(w.spend_cents / 100 / w.booked_calls).toFixed(2)}` : "none yet",
  };
}

/**
 * Everything Migz needs for one review: the campaign tree with 14-day and 3-day results per ad,
 * creatives not yet running, videos being made, the account's money, and Migz's recent actions.
 * Returns both the model-facing summary and the state the guardrails check against.
 */
export async function buildSnapshot(agent: Agent) {
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const since14 = today.minus({ days: LOOKBACK_DAYS - 1 }).toISODate()!;
  const since3 = today.minus({ days: 2 }).toISODate()!;

  const [campaigns, adsets, ads, insights, bookings, library, jobs, actions, balance] = await Promise.all([
    supabaseAdmin.from("ad_campaigns").select("*").eq("agent_id", agent.id),
    supabaseAdmin.from("ad_sets").select("*").eq("agent_id", agent.id).neq("status", "DELETED"),
    supabaseAdmin.from("ads").select("*, creatives(kind, source, hook, file_name, script)").eq("agent_id", agent.id),
    supabaseAdmin.from("ad_insights_daily").select("*").eq("agent_id", agent.id).gte("date", since14),
    supabaseAdmin
      .from("bookings")
      .select("created_at, attribution")
      .eq("agent_id", agent.id)
      .gte("created_at", DateTime.fromISO(since14, { zone: agent.timezone }).toUTC().toISO()!),
    supabaseAdmin
      .from("creatives")
      .select("id, kind, source, file_name, hook, status, created_at")
      .eq("agent_id", agent.id)
      .in("status", ["submitted", "in_review"]),
    supabaseAdmin
      .from("creative_jobs")
      .select("stage, brief, launch_adset_id, created_at")
      .eq("agent_id", agent.id)
      .in("stage", ["generating", "stored", "meta_processing"]),
    supabaseAdmin
      .from("ad_actions")
      .select("kind, title, detail, status, created_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false })
      .limit(12),
    getBalanceCents(agent.id),
  ]);

  // Booked calls per ad come from our bookings: Meta fills utm_content with the ad id
  const bookingsByAd = new Map<string, { d14: number; d3: number }>();
  for (const b of bookings.data ?? []) {
    const adId = (b.attribution as Record<string, string>)?.utm_content;
    if (!adId) continue;
    const date = DateTime.fromISO(b.created_at).setZone(agent.timezone).toISODate()!;
    const entry = bookingsByAd.get(adId) ?? { d14: 0, d3: 0 };
    entry.d14 += 1;
    if (date >= since3) entry.d3 += 1;
    bookingsByAd.set(adId, entry);
  }

  const perAd = new Map<string, { d14: Window; d3: Window }>();
  for (const r of insights.data ?? []) {
    const entry = perAd.get(r.meta_ad_id) ?? { d14: emptyWindow(), d3: emptyWindow() };
    for (const [w, include] of [[entry.d14, true], [entry.d3, r.date >= since3]] as const) {
      if (!include) continue;
      w.spend_cents += r.spend_cents;
      w.impressions += r.impressions;
      w.clicks += r.clicks;
    }
    perAd.set(r.meta_ad_id, entry);
  }
  for (const [adId, b] of bookingsByAd) {
    const entry = perAd.get(adId) ?? { d14: emptyWindow(), d3: emptyWindow() };
    entry.d14.booked_calls = b.d14;
    entry.d3.booked_calls = b.d3;
    perAd.set(adId, entry);
  }

  const guardAdsets: AdSetState[] = (adsets.data ?? []).map((s) => ({
    meta_adset_id: s.meta_adset_id,
    status: s.status,
    daily_budget_cents: s.daily_budget_cents,
    learning_status: s.learning_status,
    last_edited_at: s.last_edited_at,
    ads: (ads.data ?? [])
      .filter((a) => a.adset_id === s.id)
      .map((a) => ({
        meta_ad_id: a.meta_ad_id,
        status: a.status,
        impressions: perAd.get(a.meta_ad_id)?.d14.impressions ?? 0,
        spend_cents: perAd.get(a.meta_ad_id)?.d14.spend_cents ?? 0,
      })),
  }));

  const totals = emptyWindow();
  for (const { d14 } of perAd.values()) {
    totals.spend_cents += d14.spend_cents;
    totals.impressions += d14.impressions;
    totals.clicks += d14.clicks;
    totals.booked_calls += d14.booked_calls;
  }

  const forModel = {
    agent: {
      name: agent.full_name,
      licensed_states: agent.licensed_states,
      daily_budget_cap: `$${(agent.daily_budget_cents / 100).toFixed(2)}`,
      balance: `$${(balance / 100).toFixed(2)}`,
      days_of_funding_left: agent.daily_budget_cents ? Math.floor(balance / agent.daily_budget_cents) : null,
      ads_paused_by_agent: agent.ads_paused,
      today: today.toISODate(),
    },
    account_last_14_days: summarize(totals),
    campaigns: (campaigns.data ?? []).map((c) => ({
      campaign_id: c.meta_campaign_id,
      name: c.name,
      status: c.status,
      ad_sets: (adsets.data ?? [])
        .filter((s) => s.campaign_id === c.id)
        .map((s) => ({
          adset_id: s.meta_adset_id,
          name: s.name,
          status: s.status,
          daily_budget: `$${(s.daily_budget_cents / 100).toFixed(2)}`,
          meta_learning_status: s.learning_status ?? "unknown",
          last_changed: DateTime.fromISO(s.last_edited_at).toRelative({ base: DateTime.now() }),
          placements: s.placements.length ? s.placements : "automatic (Advantage+)",
          ads: (ads.data ?? [])
            .filter((a) => a.adset_id === s.id)
            .map((a) => {
              const creative = a.creatives as { kind?: string; source?: string; hook?: string; script?: unknown } | null;
              const results = perAd.get(a.meta_ad_id) ?? { d14: emptyWindow(), d3: emptyWindow() };
              return {
                ad_id: a.meta_ad_id,
                name: a.name,
                status: a.status,
                creative: creative
                  ? `${creative.kind} (${creative.source === "migz" ? "made by Migz" : "agent upload"})${creative.hook ? `, ${creative.kind === "image" ? "text" : "hook"}: "${creative.hook}"` : ""}`
                  : "unknown",
                // Only Migz videos have body shots to reuse with a new hook
                can_make_hook_variants: !!creative?.script && !isImageBrief(creative.script as AnyBrief),
                headline: a.headline,
                last_14_days: summarize(results.d14),
                last_3_days: summarize(results.d3),
              };
            }),
        })),
    })),
    creatives_not_running: (library.data ?? []).map((c) => ({
      creative_id: c.id,
      kind: c.kind,
      source: c.source === "migz" ? "made by Migz" : "agent upload",
      name: c.file_name,
      hook: c.hook,
    })),
    creatives_being_made: (jobs.data ?? []).map((j) => ({
      format: isImageBrief(j.brief as AnyBrief) ? "image" : "video",
      label: briefLabel(j.brief as AnyBrief),
      stage: j.stage,
      launching_into: j.launch_adset_id,
    })),
    recent_migz_actions: (actions.data ?? []).map((a) => ({
      when: DateTime.fromISO(a.created_at).toRelative({ base: DateTime.now() }),
      kind: a.kind,
      title: a.title,
      status: a.status,
      detail: a.detail,
    })),
  };

  return {
    forModel,
    guardAdsets,
    openGenerations: (jobs.data ?? []).filter((j) => j.stage === "generating").length,
    hasCampaign: (campaigns.data ?? []).length > 0,
    balanceCents: balance,
  };
}

export type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;
