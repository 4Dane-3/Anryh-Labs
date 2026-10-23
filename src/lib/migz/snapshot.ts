import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { getBalanceCents } from "@/lib/dashboard/queries";
import type { AdSetState } from "@/lib/migz/guardrails";
import { LOOKBACK_DAYS } from "@/lib/migz/sync";
import { briefLabel, isCarouselBrief, isImageBrief, isVideoBrief, type AnyBrief } from "@/lib/migz/brief";
import { addRow, derive, emptyTotals, fatigue, present, type Totals } from "@/lib/migz/metrics";
import { cleanFocus, TOPICS } from "@/lib/migz/topics";
import { daysLeft, REVISE_AFTER_DAYS } from "@/lib/campaign";
import { getActiveBatch } from "@/lib/dashboard/batches";
import { latestIdeas } from "@/lib/migz/research";
import { emptyPlatformStats, platformOf, PLATFORMS, strongerPlatform, type PlatformStats } from "@/lib/migz/platforms";

/**
 * Everything Migz needs for one review: the campaign tree with 14-day and 3-day results per ad,
 * creatives not yet running, videos being made, the account's money, and Migz's recent actions.
 * Returns both the model-facing summary and the state the guardrails check against.
 */
export async function buildSnapshot(agent: Agent) {
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const since14 = today.minus({ days: LOOKBACK_DAYS - 1 }).toISODate()!;
  const since3 = today.minus({ days: 2 }).toISODate()!;

  const [campaigns, adsets, ads, insights, bookings, library, jobs, actions, balance, placementRows, visitRows, batch] = await Promise.all([
    // Campaigns a batch retired are paused and out of play: they don't count toward budgets or reviews
    supabaseAdmin.from("ad_campaigns").select("*").eq("agent_id", agent.id).is("retired_at", null),
    supabaseAdmin.from("ad_sets").select("*, ad_campaigns!inner(retired_at)").eq("agent_id", agent.id).neq("status", "DELETED").is("ad_campaigns.retired_at", null),
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
    supabaseAdmin
      .from("ad_placement_daily")
      .select("meta_ad_id, publisher_platform, platform_position, spend_cents, impressions, link_clicks, video_3s_views, thruplays")
      .eq("agent_id", agent.id)
      .gte("date", since14),
    supabaseAdmin
      .from("page_visits")
      .select("utm_content, created_at")
      .eq("agent_id", agent.id)
      .gte("created_at", DateTime.fromISO(since14, { zone: agent.timezone }).toUTC().toISO()!),
    getActiveBatch(agent.id),
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

  const perAd = new Map<string, { d14: Totals; d3: Totals }>();
  const entryFor = (adId: string) => {
    const entry = perAd.get(adId) ?? { d14: emptyTotals(), d3: emptyTotals() };
    perAd.set(adId, entry);
    return entry;
  };
  for (const r of insights.data ?? []) {
    const entry = entryFor(r.meta_ad_id);
    addRow(entry.d14, r);
    if (r.date >= since3) addRow(entry.d3, r);
  }
  for (const [adId, b] of bookingsByAd) {
    const entry = entryFor(adId);
    entry.d14.booked_calls = b.d14;
    entry.d3.booked_calls = b.d3;
  }
  for (const v of visitRows.data ?? []) {
    if (!v.utm_content) continue;
    const entry = entryFor(v.utm_content);
    entry.d14.visits += 1;
    if (DateTime.fromISO(v.created_at).setZone(agent.timezone).toISODate()! >= since3) entry.d3.visits += 1;
  }
  const derivedFor = (adId: string) => {
    const t = perAd.get(adId) ?? { d14: emptyTotals(), d3: emptyTotals() };
    const d14 = derive(t.d14);
    const d3 = derive(t.d3);
    return { t, d14, d3, fatigue: fatigue(d14, d3) };
  };

  // Placement results per ad set (by Meta ad id -> ad set)
  const adsetOfAd = new Map<string, string>();
  for (const a of ads.data ?? []) adsetOfAd.set(a.meta_ad_id, a.adset_id);
  const placementsBySet = new Map<string, Map<string, Totals>>();
  for (const p of placementRows.data ?? []) {
    const setId = adsetOfAd.get(p.meta_ad_id);
    if (!setId) continue;
    const bySet = placementsBySet.get(setId) ?? new Map<string, Totals>();
    const key = `${p.publisher_platform} ${p.platform_position}`;
    const t = bySet.get(key) ?? emptyTotals();
    addRow(t, { ...p, date: "", clicks: 0 });
    bySet.set(key, t);
    placementsBySet.set(setId, bySet);
  }

  // Facebook vs Instagram per ad set: spend from Meta's placement breakdown, booked calls from the placement
  // each booking's link carried (utm_term). Bookings from ads made before that tag existed are "untracked".
  const platformsBySet = new Map<string, PlatformStats>();
  const statsFor = (setId: string) => {
    const st = platformsBySet.get(setId) ?? emptyPlatformStats();
    platformsBySet.set(setId, st);
    return st;
  };
  for (const p of placementRows.data ?? []) {
    const setId = adsetOfAd.get(p.meta_ad_id);
    const platform = platformOf(p.publisher_platform);
    if (!setId || !platform) continue;
    const t = statsFor(setId)[platform];
    t.spendCents += p.spend_cents;
    t.impressions += p.impressions;
    t.linkClicks += p.link_clicks;
  }
  const untrackedBySet = new Map<string, number>();
  for (const b of bookings.data ?? []) {
    const attr = (b.attribution as Record<string, string>) ?? {};
    const setId = attr.utm_content ? adsetOfAd.get(attr.utm_content) : undefined;
    if (!setId) continue;
    const platform = platformOf(attr.utm_term);
    if (platform) statsFor(setId)[platform].bookedCalls += 1;
    else untrackedBySet.set(setId, (untrackedBySet.get(setId) ?? 0) + 1);
  }
  const accountPlatforms = emptyPlatformStats();
  for (const st of platformsBySet.values())
    for (const pl of PLATFORMS) for (const k of ["spendCents", "impressions", "linkClicks", "bookedCalls"] as const) accountPlatforms[pl][k] += st[pl][k];
  const presentPlatforms = (st: PlatformStats, untracked: number) => {
    const row = (pl: (typeof PLATFORMS)[number]) => {
      const t = st[pl];
      return {
        spend: `$${(t.spendCents / 100).toFixed(2)}`,
        impressions: t.impressions,
        link_ctr: t.impressions ? `${((t.linkClicks / t.impressions) * 100).toFixed(2)}%` : "n/a",
        booked_calls: t.bookedCalls,
        cost_per_booked_call: t.bookedCalls ? `$${(t.spendCents / t.bookedCalls / 100).toFixed(2)}` : "n/a",
      };
    };
    const better = strongerPlatform(st);
    return {
      facebook: row("facebook"),
      instagram: row("instagram"),
      ...(untracked ? { booked_calls_without_a_placement: untracked } : {}),
      focus: better
        ? `${better} books calls clearly cheaper on enough data: focusing this ad set on ${better} is allowed (it restarts learning)`
        : "no clear winner yet: keep automatic placements",
    };
  };

  const guardAdsets: AdSetState[] = (adsets.data ?? []).map((s) => ({
    meta_adset_id: s.meta_adset_id,
    status: s.status,
    daily_budget_cents: s.daily_budget_cents,
    learning_status: s.learning_status,
    last_edited_at: s.last_edited_at,
    platforms: platformsBySet.get(s.id) ?? emptyPlatformStats(),
    ads: (ads.data ?? [])
      .filter((a) => a.adset_id === s.id)
      .map((a) => ({
        meta_ad_id: a.meta_ad_id,
        status: a.status,
        impressions: perAd.get(a.meta_ad_id)?.d14.impressions ?? 0,
        spend_cents: perAd.get(a.meta_ad_id)?.d14.spend_cents ?? 0,
        thruplays: perAd.get(a.meta_ad_id)?.d14.thruplays ?? 0,
      })),
  }));

  const totals = emptyTotals();
  for (const { d14 } of perAd.values()) {
    totals.spend_cents += d14.spend_cents;
    totals.impressions += d14.impressions;
    totals.clicks += d14.clicks;
    totals.link_clicks += d14.link_clicks;
    totals.video_3s_views += d14.video_3s_views;
    totals.thruplays += d14.thruplays;
    totals.booked_calls += d14.booked_calls;
    totals.visits += d14.visits;
  }

  // Ad set averages: the diagnosis ladder compares each ad against its own ad set, not benchmarks
  const adsetAverage = (setId: string) => {
    const t = emptyTotals();
    for (const a of (ads.data ?? []).filter((x) => x.adset_id === setId)) {
      const e = perAd.get(a.meta_ad_id);
      if (!e) continue;
      for (const k of ["spend_cents", "impressions", "clicks", "link_clicks", "video_3s_views", "thruplays", "booked_calls", "visits", "video_plays", "p25", "p50", "p75", "p100", "reach"] as const)
        t[k] += e.d14[k];
    }
    return present(derive(t));
  };

  // What the agent wants advertised, and how much of what's live serves each topic
  const focus = cleanFocus(agent.ad_focus);
  const liveByTopic = new Map<string, number>();
  for (const a of ads.data ?? []) {
    if (a.status !== "ACTIVE") continue;
    const topic = ((a.creatives as { script?: { topic?: string } } | null)?.script?.topic) ?? "untagged";
    liveByTopic.set(topic, (liveByTopic.get(topic) ?? 0) + 1);
  }

  // If the latest creative attempt was refused for lack of credits (in the last 2 hours), tell the model so
  // it doesn't burn actions retrying; once credits are added and a later attempt works, or after 2 hours, it tries again
  const { data: lastJob } = await supabaseAdmin
    .from("creative_jobs")
    .select("stage, error, created_at")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const outOfCredits =
    lastJob?.stage === "failed" &&
    /credits/i.test(lastJob.error ?? "") &&
    Date.now() - new Date(lastJob.created_at).getTime() < 2 * 3_600_000
      ? 1
      : 0;
  const refusedAt = lastJob?.created_at ?? null;

  // What's live and in the works, by format, so the model fills gaps instead of repeating one format
  const formatOf = (kind?: string, script?: AnyBrief | null) =>
    kind === "video" ? "reel_video_9x16" : script && isCarouselBrief(script) ? "carousel_2_cards" : script && isImageBrief(script) ? (script.aspect_ratio === "9:16" ? "story_image_9x16" : "feed_image_4x5") : kind === "image" ? "image_upload" : "unknown";
  const liveByFormat: Record<string, number> = {};
  for (const a of ads.data ?? []) {
    if (a.status !== "ACTIVE") continue;
    const c = a.creatives as { kind?: string; script?: AnyBrief | null } | null;
    const f = formatOf(c?.kind, c?.script);
    liveByFormat[f] = (liveByFormat[f] ?? 0) + 1;
  }
  const beingMadeByFormat: Record<string, number> = {};
  for (const j of jobs.data ?? []) {
    const b = j.brief as AnyBrief;
    const f = isCarouselBrief(b) ? "carousel_2_cards" : isImageBrief(b) ? (b.aspect_ratio === "9:16" ? "story_image_9x16" : "feed_image_4x5") : "reel_video_9x16";
    beingMadeByFormat[f] = (beingMadeByFormat[f] ?? 0) + 1;
  }

  const revisionsFrom = agent.campaign_started_on
    ? DateTime.fromISO(agent.campaign_started_on, { zone: agent.timezone }).plus({ days: REVISE_AFTER_DAYS }).toISODate()!
    : null;
  const adsetsByTopic = new Map<string, string[]>();
  for (const c of campaigns.data ?? []) {
    if (!c.topic) continue;
    const ids = (adsets.data ?? []).filter((x) => x.campaign_id === c.id).map((x) => x.meta_adset_id);
    adsetsByTopic.set(c.topic, [...(adsetsByTopic.get(c.topic) ?? []), ...ids]);
  }

  // The research shift's latest ideas (market → history → clerk), as inspiration for new creatives
  const researchIdeas = await latestIdeas(agent.id);

  const forModel = {
    market_research_ideas: researchIdeas.length
      ? {
          note: "Ideas from your research shift, checked against this account's history and Meta's ad rules. Use them as inspiration when you make new creatives (pick what fits the ad sets that need creative); never copy outside wording.",
          ideas: researchIdeas,
        }
      : "none yet",
    agent: {
      name: agent.full_name,
      licensed_states: agent.licensed_states,
      daily_budget_cap: `$${(agent.daily_budget_cents / 100).toFixed(2)}`,
      // A running batch's budget is set aside from the balance, so it's funded through the batch's last day
      balance: batch
        ? `$${(balance / 100).toFixed(2)} free, plus $${(batch.budget_cents / 100).toFixed(2)} set aside for the running batch`
        : `$${(balance / 100).toFixed(2)}`,
      days_of_funding_left: batch?.ends_on
        ? daysLeft(batch.ends_on, agent.timezone)
        : agent.daily_budget_cents ? Math.floor(balance / agent.daily_budget_cents) : null,
      ads_paused_by_agent: agent.ads_paused,
      // Test mode keeps campaigns paused on purpose (set by the account manager, not something to fix)
      test_mode: process.env.MIGZ_TEST_MODE === "1"
        ? "on: campaigns stay paused and every ad you launch is built paused, so the agent can preview the finished ads in Meta Ads Manager and nothing delivers or spends. Build and launch ads as normal (launch creatives into the ad set), and don't ask the agent to turn the campaign on; the ads switch on when test mode ends"
        : "off",
      today: today.toISODate(),
      batch: batch
        ? {
            budget: `$${(batch.budget_cents / 100).toFixed(2)} of ad spend over ${batch.days} days`,
            plan: `${batch.option}: ${batch.campaigns.length} campaign${batch.campaigns.length === 1 ? "" : "s"} the agent chose`,
            note: batch.campaigns.length === 1
              ? "One focused campaign: there's no second campaign to compare against, so compare ads and formats within it."
              : "Spend the batch to get the most booked calls; move budget between its campaigns once the results phase is over.",
          }
        : "no active batch",
      campaign: {
        started_on: agent.campaign_started_on ?? "not started",
        runs_until: agent.campaign_ends_on ?? (agent.campaign_days === 0 ? "ongoing (no end date)" : "no end date set"),
        days_left: daysLeft(agent.campaign_ends_on, agent.timezone),
        // The plan the agent was shown: results first, then revisions, then check they worked
        revisions_from: revisionsFrom,
        phase: !revisionsFrom
          ? "not started"
          : today.toISODate()! < revisionsFrom
            ? `collecting results: the first ${REVISE_AFTER_DAYS} days are for data. Build and launch creative for every campaign, but don't pause ads, move budget or change placements yet (the system refuses). Compare the campaigns from ${revisionsFrom}.`
            : "revising: compare the campaigns and their ads, revise what's losing (hooks, copy, budget between campaigns), then judge whether each change helped before the campaign ends",
        note: agent.campaign_ends_on ? "The agent chose this length. Pace tests so winners are found with time left to benefit; don't start long tests near the end." : undefined,
      },
      creative_generation: outOfCredits > 0
        ? `uncertain: the generator refused the last attempt (${DateTime.fromISO(refusedAt!).toRelative({ base: DateTime.now() })}) for lack of credits, but credits may have been added since. Try ONE creative now (an image first: they cost the least). If it fails again, stop starting creatives this review and say so; if it works, carry on as normal next review.`
        : "available",
    },
    ad_focus: focus.length
      ? focus.map((key, i) => ({
          topic: key,
          priority: i === 0 ? "main focus" : `focus ${i + 1}`,
          label: TOPICS[key].label,
          what_to_sell: TOPICS[key].pitch,
          angle_notes: TOPICS[key].angle,
          live_ads_on_this_topic: liveByTopic.get(key) ?? 0,
          ad_sets_for_this_topic: adsetsByTopic.get(key) ?? [],
        }))
      : "not set: choose from the proven angles",
    live_ads_by_topic: Object.fromEntries(liveByTopic),
    creative_mix: {
      live_ads_by_format: liveByFormat,
      being_made_by_format: beingMadeByFormat,
      target: "each ad set runs 4:5 feed images, 9:16 Stories/Reels images and 9:16 reel videos; images are cheap, videos are limited to 1 new one per review. A 2-card carousel is an option when a message works as two beats",
    },
    account_last_14_days: present(derive(totals)),
    platform_split_last_14_days: presentPlatforms(accountPlatforms, [...untrackedBySet.values()].reduce((a, b) => a + b, 0)),
    campaigns: (campaigns.data ?? []).map((c) => ({
      campaign_id: c.meta_campaign_id,
      name: c.name,
      status: c.status,
      serves_topic: c.topic && c.topic in TOPICS ? `${c.topic} (${TOPICS[c.topic as keyof typeof TOPICS].label})` : "any topic",
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
          ad_set_average_last_14_days: adsetAverage(s.id),
          results_by_platform_last_14_days: presentPlatforms(platformsBySet.get(s.id) ?? emptyPlatformStats(), untrackedBySet.get(s.id) ?? 0),
          results_by_placement_last_14_days: [...(placementsBySet.get(s.id) ?? new Map<string, Totals>())]
            .sort((x, y) => y[1].spend_cents - x[1].spend_cents)
            .slice(0, 8)
            .map(([placement, t]) => {
              const d = derive(t);
              return {
                placement,
                spend: `$${d.spend_usd.toFixed(2)}`,
                impressions: d.impressions,
                link_ctr: d.link_ctr === null ? "n/a" : `${(d.link_ctr * 100).toFixed(2)}%`,
                hook_rate: d.hook_rate === null ? "n/a" : `${(d.hook_rate * 100).toFixed(1)}%`,
                cpm: d.cpm_usd === null ? "n/a" : `$${d.cpm_usd.toFixed(2)}`,
              };
            }),
          ads: (ads.data ?? [])
            .filter((a) => a.adset_id === s.id)
            .map((a) => {
              const creative = a.creatives as { kind?: string; source?: string; hook?: string; script?: unknown } | null;
              const results = derivedFor(a.meta_ad_id);
              return {
                ad_id: a.meta_ad_id,
                name: a.name,
                status: a.status,
                creative: creative
                  ? `${creative.kind} (${creative.source === "migz" ? "made by Migz" : "agent upload"})${creative.hook ? `, ${creative.kind === "image" ? "text" : "hook"}: "${creative.hook}"` : ""}`
                  : "unknown",
                // Only Migz videos have body shots to reuse with a new hook
                can_make_hook_variants: !!creative?.script && isVideoBrief(creative.script as AnyBrief),
                headline: a.headline,
                last_14_days: present(results.d14),
                last_3_days: present(results.d3),
                fatigue: results.fatigue.signals.length ? results.fatigue.signals.join("; ") : "none",
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
      format: isCarouselBrief(j.brief as AnyBrief) ? "carousel" : isImageBrief(j.brief as AnyBrief) ? "image" : "video",
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

  const adMetrics = new Map([...perAd.keys()].map((id) => [id, derivedFor(id)]));

  return {
    forModel,
    adMetrics,
    guardAdsets,
    openGenerations: (jobs.data ?? []).filter((j) => j.stage === "generating").length,
    hasCampaign: (campaigns.data ?? []).length > 0,
    creditsRecentlyRefused: outOfCredits > 0,
    focus,
    balanceCents: balance,
    revisionsFrom,
  };
}

export type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;
