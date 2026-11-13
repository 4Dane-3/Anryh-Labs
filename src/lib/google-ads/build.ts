import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { adLinkFor } from "@/lib/booking/sites";
import { cleanRules } from "@/lib/roofing/job-rules";
import { createdNames, microsOf, mutate, request, validateOnly, type MutateOperation } from "@/lib/google-ads/api";
import { saveGoogleAccount, type GoogleAccount } from "@/lib/google-ads/account";
import { cityOf, idOf, proximityAddress } from "@/lib/google-ads/ids";
import { adGroupPlans, BASE_NEGATIVES, CALL_MIN_SECONDS, callouts, CONVERSIONS, dailyFromMonthly, DEFAULT_JOB_VALUE_DOLLARS, negativesFor } from "@/lib/google-ads/playbook";
import { radiusMiles } from "@/lib/verticals";

// Builds a roofer's Google Ads account the way the playbook says, once it's linked and they've started their
// campaign: auto-tagging on (every click carries a gclid back to their page), Migz's conversion actions (booked
// inspection, 60s+ call from the ad, closed job), and one Search campaign: Google Search only, people in their
// radius, English, Maximize conversions, a daily budget from their monthly cap, an ad group per kind of job they
// take with phrase and exact keywords and a responsive search ad, the starting negatives, a call asset and callouts.

export const ENGLISH = "languageConstants/1000";

type Brand = { deals?: string[]; certifications?: string[]; warranties?: string[] } | null;

async function brandOf(agentId: string): Promise<Brand> {
  const { data } = await supabaseAdmin.from("agent_brand").select("deals, certifications, warranties").eq("agent_id", agentId).maybeSingle();
  return (data as Brand) ?? null;
}

/** Turns on auto-tagging, so each ad click arrives with a gclid we can send back as a conversion. */
async function enableAutoTagging(customerId: string) {
  await request(`customers/${customerId}:mutate`, { operation: { update: { resourceName: `customers/${customerId}`, autoTaggingEnabled: true }, updateMask: "autoTaggingEnabled" }, validateOnly: validateOnly() });
}

/** Migz's three conversion actions, made once. Returns their resource names. */
export async function ensureConversions(agent: Agent, account: GoogleAccount) {
  const have = account.conversion_actions ?? {};
  if (have.booked && have.call && have.closed) return have;
  const cid = account.customer_id;
  const value = agent.avg_job_dollars ?? DEFAULT_JOB_VALUE_DOLLARS;
  const ops: { key: "booked" | "call" | "closed"; op: MutateOperation }[] = [];
  if (!have.booked)
    ops.push({ key: "booked", op: { conversionActionOperation: { create: { name: CONVERSIONS.booked.name, type: "UPLOAD_CLICKS", category: CONVERSIONS.booked.category, status: "ENABLED", primaryForGoal: true, countingType: "ONE_PER_CLICK", valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false } } } } });
  if (!have.call)
    ops.push({ key: "call", op: { conversionActionOperation: { create: { name: CONVERSIONS.call.name, type: "AD_CALL", category: CONVERSIONS.call.category, status: "ENABLED", primaryForGoal: true, countingType: "ONE_PER_CLICK", phoneCallDurationSeconds: CALL_MIN_SECONDS } } } });
  if (!have.closed)
    ops.push({ key: "closed", op: { conversionActionOperation: { create: { name: CONVERSIONS.closed.name, type: "UPLOAD_CLICKS", category: CONVERSIONS.closed.category, status: "ENABLED", primaryForGoal: false, countingType: "ONE_PER_CLICK", valueSettings: { defaultValue: value, defaultCurrencyCode: "USD", alwaysUseDefaultValue: false } } } } });
  const names = createdNames(await mutate(cid, ops.map((o) => o.op)));
  const out = { ...have };
  ops.forEach((o, i) => {
    if (names[i]) out[o.key] = names[i];
  });
  if (!validateOnly()) await saveGoogleAccount(agent.id, { conversion_actions: out });
  return out;
}

/** The operations that build the Search campaign (temporary ids tie them together in one request). */
export function campaignOperations(input: {
  customerId: string;
  agent: Pick<Agent, "full_name" | "service_area" | "service_radius_miles" | "licensed_states" | "call_phone" | "lead_goal" | "job_rules"> & { slug: string; booking_choice?: string | null; own_booking_url?: string | null };
  brand: Brand;
  monthlyCapCents: number;
  callConversion: string | null;
  landingUrl: string;
  /** PAUSED builds it without spending (the competitor-beating ad goes in paused for a person to review). */
  status?: "ENABLED" | "PAUSED";
  name?: string;
  /** One ad for every ad group instead of each group's own (the 15 headlines and 4 descriptions that beat the competitors). */
  rsa?: { headlines: string[]; descriptions: string[]; path1: string; path2: string };
}) {
  const { customerId: cid, agent, brand } = input;
  const res = (kind: string, id: number) => `customers/${cid}/${kind}/${id}`;
  const budget = res("campaignBudgets", -1);
  const campaign = res("campaigns", -2);
  const rules = cleanRules(agent.job_rules);
  const company = agent.full_name?.trim() || "Local Roofing";
  const city = cityOf(agent.service_area);
  const offer = agent.lead_goal === "quote" ? "quote" : "inspection";
  const facts = { company, city, rules, offer, special: brand?.deals?.find(Boolean) ?? null, warranty: brand?.warranties?.find(Boolean) ?? null, certification: brand?.certifications?.find(Boolean) ?? null } as const;
  const groups = adGroupPlans(facts);
  const address = proximityAddress(agent.service_area ?? "", agent.licensed_states?.[0]);
  if (!address) throw new Error("Add your service area (a ZIP, city or address) so Google knows where to show your ads.");

  const ops: MutateOperation[] = [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `Migz roofing budget ${Date.now()}`, amountMicros: microsOf(dailyFromMonthly(input.monthlyCapCents)), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    {
      campaignOperation: {
        create: {
          resourceName: campaign,
          name: input.name ?? `Migz | ${company.slice(0, 60)} | Search`,
          status: input.status ?? "ENABLED",
          advertisingChannelType: "SEARCH",
          campaignBudget: budget,
          maximizeConversions: {},
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
          finalUrlSuffix: "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}",
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        },
      },
    },
    { campaignCriterionOperation: { create: { campaign, proximity: { address, radius: radiusMiles(agent), radiusUnits: "MILES" } } } },
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: ENGLISH } } } },
  ];
  const negatives = [...new Set([...BASE_NEGATIVES, ...negativesFor(rules)])];
  for (const text of negatives) ops.push({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text, matchType: "PHRASE" } } } });

  groups.forEach((g, i) => {
    const adGroup = res("adGroups", -10 - i);
    ops.push({ adGroupOperation: { create: { resourceName: adGroup, name: g.name, campaign, status: "ENABLED", type: "SEARCH_STANDARD" } } });
    for (const k of g.keywords) ops.push({ adGroupCriterionOperation: { create: { adGroup, status: "ENABLED", keyword: { text: k.text, matchType: k.match } } } });
    const ad = input.rsa ?? g;
    ops.push({
      adGroupAdOperation: {
        create: {
          adGroup,
          status: "ENABLED",
          ad: { finalUrls: [input.landingUrl], responsiveSearchAd: { headlines: ad.headlines.map((text) => ({ text })), descriptions: ad.descriptions.map((text) => ({ text })), path1: ad.path1 || undefined, path2: ad.path2 || undefined } },
        },
      },
    });
  });

  // Assets: the call button and the callouts under the ad
  let assetId = -100;
  const phone = agent.call_phone?.replace(/^\+1/, "").replace(/\D/g, "");
  if (phone && phone.length === 10) {
    const asset = res("assets", assetId--);
    ops.push({ assetOperation: { create: { resourceName: asset, callAsset: { countryCode: "US", phoneNumber: phone, ...(input.callConversion ? { callConversionReportingState: "USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION", callConversionAction: input.callConversion } : {}) } } } });
    ops.push({ campaignAssetOperation: { create: { campaign, asset, fieldType: "CALL" } } });
  }
  for (const text of callouts({ offer, warranty: facts.warranty, certification: facts.certification, emergencies: rules?.emergencies ?? true })) {
    const asset = res("assets", assetId--);
    ops.push({ assetOperation: { create: { resourceName: asset, calloutAsset: { calloutText: text } } } });
    ops.push({ campaignAssetOperation: { create: { campaign, asset, fieldType: "CALLOUT" } } });
  }
  return { ops, groups };
}

/** Builds the campaign in their account. Safe to call again: it does nothing once a campaign exists. */
export async function buildCampaign(agent: Agent, account: GoogleAccount) {
  if (account.campaign_id) return { built: false as const, campaignId: account.campaign_id };
  await enableAutoTagging(account.customer_id);
  const conversions = await ensureConversions(agent, account);
  const { ops, groups } = campaignOperations({ customerId: account.customer_id, agent, brand: await brandOf(agent.id), monthlyCapCents: account.monthly_cap_cents, callConversion: conversions.call ?? null, landingUrl: adLinkFor(agent, process.env.APP_URL) });
  const names = createdNames(await mutate(account.customer_id, ops));
  if (validateOnly()) return { built: false as const, campaignId: null, validated: true, groups: groups.length };
  const campaignId = idOf(names[1] ?? "");
  await saveGoogleAccount(agent.id, { campaign_id: campaignId || null, budget_resource: names[0] || null, launched_at: new Date().toISOString() });
  return { built: true as const, campaignId, groups: groups.length };
}
