import "server-only";
import { microsOf, mutate, type MutateOperation } from "@/lib/google-ads/api";
import { cleanKeyword, type GAction } from "@/lib/google-ads/guardrails";

// Applies a checked Google Ads change. Every change goes through mutate, so validate-only mode (test mode) has
// Google check it without changing anything.

export type ExecTarget = { customerId: string; campaignId: string; budgetResource: string | null; landingUrl: string };

export function operationsFor(a: GAction, t: ExecTarget): MutateOperation[] {
  const cid = t.customerId;
  const campaign = `customers/${cid}/campaigns/${t.campaignId}`;
  const adGroup = (id: string) => `customers/${cid}/adGroups/${id}`;
  switch (a.tool) {
    case "add_negative_keywords":
      return a.terms.map((x) => ({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: cleanKeyword(x.text), matchType: x.match } } } }));
    case "add_keywords":
      return a.keywords.map((k) => ({ adGroupCriterionOperation: { create: { adGroup: adGroup(a.ad_group_id), status: "ENABLED", keyword: { text: cleanKeyword(k.text), matchType: k.match } } } }));
    case "pause_keyword":
    case "resume_keyword":
      return [{ adGroupCriterionOperation: { update: { resourceName: `customers/${cid}/adGroupCriteria/${a.ad_group_id}~${a.criterion_id}`, status: a.tool === "pause_keyword" ? "PAUSED" : "ENABLED" }, updateMask: "status" } }];
    case "write_ad":
      return [
        {
          adGroupAdOperation: {
            create: {
              adGroup: adGroup(a.ad_group_id),
              status: "ENABLED",
              ad: { finalUrls: [t.landingUrl], responsiveSearchAd: { headlines: a.headlines.map((text) => ({ text: text.trim() })), descriptions: a.descriptions.map((text) => ({ text: text.trim() })), path1: a.path1 || undefined, path2: a.path2 || undefined } },
            },
          },
        },
      ];
    case "pause_ad":
      return [{ adGroupAdOperation: { update: { resourceName: `customers/${cid}/adGroupAds/${a.ad_group_id}~${a.ad_id}`, status: "PAUSED" }, updateMask: "status" } }];
    case "set_daily_budget":
      return t.budgetResource ? [{ campaignBudgetOperation: { update: { resourceName: t.budgetResource, amountMicros: microsOf(a.daily_cents) }, updateMask: "amountMicros" } }] : [];
    case "set_bidding":
      return [{ campaignOperation: { update: { resourceName: campaign, maximizeConversions: { targetCpaMicros: a.strategy === "TARGET_CPA" && a.target_cpa_cents ? microsOf(a.target_cpa_cents) : "0" } }, updateMask: "maximizeConversions.targetCpaMicros" } }];
    case "hold":
      return [];
  }
}

export async function execute(a: GAction, t: ExecTarget) {
  const ops = operationsFor(a, t);
  if (!ops.length) return { applied: 0 };
  await mutate(t.customerId, ops);
  return { applied: ops.length };
}
