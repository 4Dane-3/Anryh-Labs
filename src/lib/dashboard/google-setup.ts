import "server-only";
import { getGoogleAccount } from "@/lib/google-ads/account";
import { GOOGLE_MIN_MONTHLY_CENTS, GOOGLE_RECOMMENDED_MONTHLY_CENTS } from "@/lib/google-ads/playbook";
import type { GoogleSetupInitial } from "@/components/dashboard/GoogleAdsSetup";
import type { Agent } from "@/lib/booking/data";

/** What the Google Ads step and page start with. */
export async function googleSetup(agent: Agent): Promise<GoogleSetupInitial> {
  const a = await getGoogleAccount(agent.id);
  return {
    account: a
      ? { customerId: a.customer_id, status: a.link_status, monthlyCapCents: a.monthly_cap_cents, enabled: a.enabled, inviteEmail: a.invite_email, built: !!a.campaign_id, lastError: a.last_error }
      : null,
    avgJobDollars: agent.avg_job_dollars ?? null,
    minMonthly: GOOGLE_MIN_MONTHLY_CENTS / 100,
    recommendedMonthly: GOOGLE_RECOMMENDED_MONTHLY_CENTS / 100,
  };
}
