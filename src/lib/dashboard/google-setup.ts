import "server-only";
import { getGoogleAccount } from "@/lib/google-ads/account";
import { GOOGLE_MIN_MONTHLY_CENTS, GOOGLE_RECOMMENDED_MONTHLY_CENTS } from "@/lib/google-ads/playbook";
import type { GoogleSetupInitial } from "@/components/dashboard/GoogleAdsSetup";
import type { Agent } from "@/lib/booking/data";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { adGroupPlans } from "@/lib/google-ads/playbook";
import { planFacts } from "@/lib/google-ads/build";
import { groupByKey, landingPageUrl } from "@/lib/landing/groups";

/** What the Google Ads step and page start with. */
export async function googleSetup(agent: Agent): Promise<GoogleSetupInitial> {
  const [a, { data: brand }] = await Promise.all([getGoogleAccount(agent.id), supabaseAdmin.from("agent_brand").select("website, deals, certifications, warranties").eq("agent_id", agent.id).maybeSingle()]);
  // A landing page for each ad group Migz makes (the jobs they take), shown with its live link
  const pages = adGroupPlans(planFacts(agent, brand ?? null)).flatMap((p) => {
    const g = groupByKey(p.key);
    return g ? [{ name: g.name, title: p.headlines[0], url: landingPageUrl(agent, p.key), preview: `/${agent.slug}/p/${g.path}` }] : [];
  });
  return {
    account: a
      ? { customerId: a.customer_id, status: a.link_status, monthlyCapCents: a.monthly_cap_cents, enabled: a.enabled, inviteEmail: a.invite_email, built: !!a.campaign_id, lastError: a.last_error }
      : null,
    adDomain: agent.ad_domain ? { domain: agent.ad_domain, live: !!agent.ad_domain_ok } : null,
    website: (brand?.website as string | null | undefined) ?? null,
    pages,
    avgJobDollars: agent.avg_job_dollars ?? null,
    minMonthly: GOOGLE_MIN_MONTHLY_CENTS / 100,
    recommendedMonthly: GOOGLE_RECOMMENDED_MONTHLY_CENTS / 100,
  };
}
