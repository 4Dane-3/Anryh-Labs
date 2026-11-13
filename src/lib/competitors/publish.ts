import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { adLinkFor } from "@/lib/booking/sites";
import { createdNames, googleAdsReady, mutate, validateOnly } from "@/lib/google-ads/api";
import { getGoogleAccount, manageable, saveGoogleAccount } from "@/lib/google-ads/account";
import { campaignOperations, ensureConversions } from "@/lib/google-ads/build";
import { checkAdText } from "@/lib/google-ads/guardrails";
import { idOf } from "@/lib/google-ads/ids";
import type { GoogleSnapshot } from "@/lib/google-ads/types";
import { getRun, logLine, saveRun } from "@/lib/competitors/store";
import type { Published } from "@/lib/competitors/types";

// Puts the ad that beat the competitors into the roofer's Google Ads account, PAUSED, for a person to review and
// switch on. Never enabled, never edits or removes what's there. Only when the 9/10 gate passed.
//   No Migz campaign yet: the whole campaign is built (the campaign plan: keywords per job, negatives, radius,
//     call and callouts) paused, with this ad in every ad group.
//   Migz's campaign already exists: this ad is added to each of its ad groups, paused, next to the running ads.

export async function publishPaused(runId: string): Promise<{ ok: true; published: Published } | { ok: false; error: string }> {
  const run = await getRun(runId);
  if (!run?.drafts) return { ok: false, error: "This run has no ads yet." };
  if (!run.drafts.verdict.publishable) return { ok: false, error: `Not publishable: ${run.drafts.verdict.why}` };
  if (!googleAdsReady()) return { ok: false, error: "The Google Ads API isn't configured yet (GOOGLE_ADS_* keys)." };
  const { data: agentRow } = await supabaseAdmin.from("agents").select("*").eq("id", run.agent_id).single();
  const agent = agentRow as Agent;
  const account = await getGoogleAccount(agent.id);
  if (!manageable(account)) return { ok: false, error: "This roofer's Google Ads account isn't linked yet." };
  const { headlines, descriptions, path1, path2 } = run.drafts.kept;
  const why = checkAdText(headlines, descriptions, path1, path2);
  if (why) return { ok: false, error: `Google would reject the ad: ${why}` };
  const rsa = { headlines, descriptions, path1, path2 };
  const landingUrl = adLinkFor(agent, process.env.APP_URL);
  const cid = account!.customer_id;
  let campaignId: string | null = account!.campaign_id;
  let campaignName: string;

  if (!campaignId) {
    const conversions = await ensureConversions(agent, account!);
    const { data: brand } = await supabaseAdmin.from("agent_brand").select("deals, certifications, warranties").eq("agent_id", agent.id).maybeSingle();
    campaignName = `Migz | ${agent.full_name.slice(0, 50)} | Search`;
    const { ops } = campaignOperations({ customerId: cid, agent, brand: brand as never, monthlyCapCents: account!.monthly_cap_cents, callConversion: conversions.call ?? null, landingUrl, status: "PAUSED", name: campaignName, rsa });
    const names = createdNames(await mutate(cid, ops));
    campaignId = idOf(names[1] ?? "") || null;
    if (!validateOnly() && campaignId) await saveGoogleAccount(agent.id, { campaign_id: campaignId, budget_resource: names[0] || null, launched_at: new Date().toISOString() });
  } else {
    const snap = account!.snapshot as GoogleSnapshot | null;
    const groups = (snap?.adGroups ?? []).filter((g) => g.campaignId === campaignId && g.status !== "REMOVED");
    if (!groups.length) return { ok: false, error: "Migz's campaign has no ad groups synced yet. Try again after the next sync." };
    campaignName = snap?.campaigns.find((c) => c.id === campaignId)?.name ?? "Migz campaign";
    await mutate(
      cid,
      groups.map((g) => ({
        adGroupAdOperation: {
          create: { adGroup: `customers/${cid}/adGroups/${g.id}`, status: "PAUSED", ad: { finalUrls: [landingUrl], responsiveSearchAd: { headlines: headlines.map((text) => ({ text })), descriptions: descriptions.map((text) => ({ text })), path1, path2 } } },
        },
      })),
    );
  }
  const published: Published = { customerId: cid, campaignId, campaignName, status: "PAUSED", validateOnly: validateOnly(), at: new Date().toISOString(), headlines: headlines.length, descriptions: descriptions.length };
  await saveRun(runId, { published, log: logLine(run, `${published.validateOnly ? "Checked with Google (validate only, nothing created)" : "Added to Google Ads, paused"}: ${campaignName}`) });
  await supabaseAdmin.from("google_ads_actions").insert({ agent_id: agent.id, tool: "system_competitor_ad", payload: { run_id: runId, campaign_id: campaignId }, title: "Added the competitor-beating ad, paused", reason: run.drafts.verdict.why, status: "applied" });
  return { ok: true, published };
}
