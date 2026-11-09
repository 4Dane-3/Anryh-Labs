import { notFound } from "next/navigation";
import { requireSetUpAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { ReferralsView } from "@/components/dashboard/Referrals";
import { getReferralsDashboard } from "@/lib/roofing/referrals";
import { isRoofer } from "@/lib/verticals";

export default async function ReferralsPage() {
  const agent = await requireSetUpAgent();
  if (!isRoofer(agent)) notFound();
  const { referrals, giftCards, ready } = await getReferralsDashboard(agent.id);
  return (
    <>
      <PageHeader
        title="Referrals"
        description="People your happy customers referred, for you to call by hand, and the gift cards customers have earned. Customers get their referral link after you tap Job done and their check-in goes well."
      />
      <ReferralsView referrals={referrals} giftCards={giftCards} timezone={agent.timezone} ready={ready} />
    </>
  );
}
