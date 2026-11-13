import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { centsOf, num, search } from "@/lib/google-ads/api";
import type { MatchType } from "@/lib/google-ads/playbook";
import { emptyMetrics, type GAd, type GCampaign, type GKeyword, type GoogleSnapshot, type GSearchTerm, type Metrics } from "@/lib/google-ads/types";
import { saveGoogleAccount } from "@/lib/google-ads/account";

// Pulls a client account's numbers: campaigns with impression share, ad groups, keywords, the search terms people
// typed, ads, negatives and daily results. Saved as the account's snapshot (what the review reads) and as daily rows.

type Row = Record<string, Record<string, unknown> | undefined>;
const f = (r: Row, obj: string, key: string) => r[obj]?.[key];
const metricsOf = (r: Row): Metrics => ({
  costCents: centsOf(f(r, "metrics", "costMicros")),
  clicks: num(f(r, "metrics", "clicks")),
  impressions: num(f(r, "metrics", "impressions")),
  conversions: Math.round(num(f(r, "metrics", "conversions")) * 10) / 10,
});
const share = (v: unknown) => (v === undefined || v === null ? null : Math.round(num(v) * 1000) / 1000);
const add = (a: Metrics, b: Metrics): Metrics => ({ costCents: a.costCents + b.costCents, clicks: a.clicks + b.clicks, impressions: a.impressions + b.impressions, conversions: Math.round((a.conversions + b.conversions) * 10) / 10 });

export async function pullSnapshot(customerId: string): Promise<{ snapshot: GoogleSnapshot; daily: { day: string; campaignId: string; m: Metrics }[] }> {
  const q = (query: string) => search<Row>(customerId, query);
  const [account, month, campaigns, daily, adGroups, keywords, terms, adsMeta, adsMetrics, negatives] = await Promise.all([
    q(`SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer`),
    q(`SELECT metrics.cost_micros FROM customer WHERE segments.date DURING THIS_MONTH`),
    q(`SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros,
        campaign_budget.resource_name, campaign_budget.amount_micros, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions,
        metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
      FROM campaign WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH' AND segments.date DURING LAST_30_DAYS`),
    q(`SELECT segments.date, campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS`),
    q(`SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`),
    q(`SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM keyword_view WHERE segments.date DURING LAST_30_DAYS AND ad_group_criterion.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 200`),
    q(`SELECT search_term_view.search_term, search_term_view.status, ad_group.id, campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM search_term_view WHERE segments.date DURING LAST_14_DAYS ORDER BY metrics.cost_micros DESC LIMIT 250`),
    q(`SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status,
        ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions
      FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`),
    q(`SELECT ad_group_ad.ad.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM ad_group_ad WHERE segments.date DURING LAST_30_DAYS AND ad_group_ad.status != 'REMOVED'`),
    q(`SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`),
  ]);

  const a = account[0] ?? {};
  const camps: GCampaign[] = campaigns.map((r) => ({
    id: String(f(r, "campaign", "id") ?? ""),
    name: String(f(r, "campaign", "name") ?? ""),
    status: String(f(r, "campaign", "status") ?? ""),
    bidding: String(f(r, "campaign", "biddingStrategyType") ?? ""),
    targetCpaCents: (() => {
      const mc = (r.campaign?.maximizeConversions as { targetCpaMicros?: string } | undefined)?.targetCpaMicros ?? (r.campaign?.targetCpa as { targetCpaMicros?: string } | undefined)?.targetCpaMicros;
      return mc ? centsOf(mc) : null;
    })(),
    budgetResource: (f(r, "campaignBudget", "resourceName") as string) ?? null,
    dailyBudgetCents: centsOf(f(r, "campaignBudget", "amountMicros")),
    impressionShare: share(f(r, "metrics", "searchImpressionShare")),
    lostToBudget: share(f(r, "metrics", "searchBudgetLostImpressionShare")),
    lostToRank: share(f(r, "metrics", "searchRankLostImpressionShare")),
    ...metricsOf(r),
  }));

  const adMetrics = new Map(adsMetrics.map((r) => [String((r.adGroupAd?.ad as { id?: string } | undefined)?.id ?? ""), metricsOf(r)]));
  const ads: GAd[] = adsMeta.map((r) => {
    const ad = (r.adGroupAd?.ad ?? {}) as { id?: string; responsiveSearchAd?: { headlines?: { text?: string }[]; descriptions?: { text?: string }[] } };
    const id = String(ad.id ?? "");
    return {
      adGroupId: String(f(r, "adGroup", "id") ?? ""),
      adId: id,
      status: String(f(r, "adGroupAd", "status") ?? ""),
      strength: (f(r, "adGroupAd", "adStrength") as string) ?? null,
      approval: ((r.adGroupAd?.policySummary as { approvalStatus?: string } | undefined)?.approvalStatus as string) ?? null,
      headlines: (ad.responsiveSearchAd?.headlines ?? []).map((h) => h.text ?? "").filter(Boolean),
      descriptions: (ad.responsiveSearchAd?.descriptions ?? []).map((d) => d.text ?? "").filter(Boolean),
      ...(adMetrics.get(id) ?? emptyMetrics()),
    };
  });

  const kws: GKeyword[] = keywords.map((r) => {
    const c = (r.adGroupCriterion ?? {}) as { criterionId?: string; status?: string; keyword?: { text?: string; matchType?: string }; qualityInfo?: { qualityScore?: number } };
    return { adGroupId: String(f(r, "adGroup", "id") ?? ""), criterionId: String(c.criterionId ?? ""), text: c.keyword?.text ?? "", match: (c.keyword?.matchType ?? "PHRASE") as MatchType, status: c.status ?? "", qualityScore: c.qualityInfo?.qualityScore ?? null, ...metricsOf(r) };
  });

  const searchTerms: GSearchTerm[] = terms.map((r) => ({
    term: String(f(r, "searchTermView", "searchTerm") ?? ""),
    status: String(f(r, "searchTermView", "status") ?? ""),
    adGroupId: String(f(r, "adGroup", "id") ?? ""),
    campaignId: String(f(r, "campaign", "id") ?? ""),
    ...metricsOf(r),
  }));

  const dailyRows = daily.map((r) => ({ day: String(f(r, "segments", "date") ?? ""), campaignId: String(f(r, "campaign", "id") ?? ""), m: metricsOf(r) })).filter((d) => d.day && d.campaignId);
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const totals30 = dailyRows.reduce((t, d) => add(t, d.m), emptyMetrics());
  const totals7 = dailyRows.filter((d) => d.day >= since7).reduce((t, d) => add(t, d.m), emptyMetrics());

  return {
    snapshot: {
      takenAt: new Date().toISOString(),
      account: { id: String(f(a, "customer", "id") ?? customerId), name: String(f(a, "customer", "descriptiveName") ?? ""), currency: String(f(a, "customer", "currencyCode") ?? "USD"), timeZone: String(f(a, "customer", "timeZone") ?? ""), status: String(f(a, "customer", "status") ?? "") },
      monthSpendCents: month.reduce((s, r) => s + centsOf(f(r, "metrics", "costMicros")), 0),
      campaigns: camps,
      adGroups: adGroups.map((r) => ({ id: String(f(r, "adGroup", "id") ?? ""), name: String(f(r, "adGroup", "name") ?? ""), status: String(f(r, "adGroup", "status") ?? ""), campaignId: String(f(r, "campaign", "id") ?? "") })),
      keywords: kws,
      searchTerms,
      ads,
      negatives: negatives.map((r) => {
        const k = (r.campaignCriterion?.keyword ?? {}) as { text?: string; matchType?: string };
        return { text: k.text ?? "", match: (k.matchType ?? "PHRASE") as MatchType };
      }),
      totals30,
      totals7,
    },
    daily: dailyRows,
  };
}

/** Syncs one account: saves the snapshot and the daily rows. */
export async function syncGoogleAccount(agentId: string, customerId: string) {
  const { snapshot, daily } = await pullSnapshot(customerId);
  if (daily.length)
    await supabaseAdmin.from("google_ads_daily").upsert(
      daily.map((d) => ({ agent_id: agentId, day: d.day, campaign_id: d.campaignId, cost_cents: d.m.costCents, clicks: d.m.clicks, impressions: d.m.impressions, conversions: d.m.conversions })),
      { onConflict: "agent_id,day,campaign_id" },
    );
  await saveGoogleAccount(agentId, { snapshot, synced_at: snapshot.takenAt });
  return snapshot;
}
