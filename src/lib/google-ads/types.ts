import type { MatchType } from "@/lib/google-ads/playbook";

// What a sync reads from a Google Ads account: the review's input and the guardrails' facts.

export type Metrics = { costCents: number; clicks: number; impressions: number; conversions: number };

export type GCampaign = Metrics & {
  id: string;
  name: string;
  status: string;
  bidding: string; // MAXIMIZE_CONVERSIONS, TARGET_CPA, MAXIMIZE_CLICKS…
  targetCpaCents: number | null;
  budgetResource: string | null;
  dailyBudgetCents: number;
  impressionShare: number | null; // 0..1
  lostToBudget: number | null; // 0..1
  lostToRank: number | null; // 0..1
};

export type GAdGroup = { id: string; name: string; status: string; campaignId: string };

export type GKeyword = Metrics & { adGroupId: string; criterionId: string; text: string; match: MatchType; status: string; qualityScore: number | null };

export type GSearchTerm = Metrics & { term: string; status: string; adGroupId: string; campaignId: string };

export type GAd = Metrics & { adGroupId: string; adId: string; status: string; strength: string | null; approval: string | null; headlines: string[]; descriptions: string[] };

export type GoogleSnapshot = {
  takenAt: string;
  account: { id: string; name: string; currency: string; timeZone: string; status: string };
  monthSpendCents: number;
  campaigns: GCampaign[];
  adGroups: GAdGroup[];
  keywords: GKeyword[]; // last 30 days, enabled and paused
  searchTerms: GSearchTerm[]; // last 14 days, by cost
  ads: GAd[]; // last 30 days
  negatives: { text: string; match: MatchType }[]; // campaign-level negative keywords
  totals30: Metrics;
  totals7: Metrics;
};

export const emptyMetrics = (): Metrics => ({ costCents: 0, clicks: 0, impressions: 0, conversions: 0 });
export const cpaCents = (m: Metrics) => (m.conversions > 0 ? Math.round(m.costCents / m.conversions) : null);
