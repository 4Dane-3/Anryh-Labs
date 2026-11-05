import { getAdminOverview } from "@/lib/admin/overview";
import { getAdminAffiliates } from "@/lib/referrals";
import { getMissedGuarantees } from "@/lib/dashboard/guarantee";
import { AdminView } from "@/components/admin/AdminView";
import { GuaranteeReviews } from "@/components/admin/GuaranteeReviews";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [overview, affiliates, missed] = await Promise.all([getAdminOverview(), getAdminAffiliates(), getMissedGuarantees().catch(() => [])]);
  return (
    <>
      {missed.length > 0 && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-8">
          <GuaranteeReviews
            items={missed.map((g) => ({
              id: g.id,
              name: g.agents?.full_name ?? "Agent",
              slug: g.agents?.slug ?? "",
              startsOn: g.starts_on,
              endsOn: g.ends_on,
              bookings: g.bookings ?? 0,
              target: g.target,
              feeCents: g.fee_cents ?? 0,
            }))}
          />
        </div>
      )}
      <AdminView initial={overview} affiliates={affiliates} />
    </>
  );
}
