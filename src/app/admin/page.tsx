import { getAdminOverview } from "@/lib/admin/overview";
import { getAdminAffiliates } from "@/lib/referrals";
import { AdminView } from "@/components/admin/AdminView";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [overview, affiliates] = await Promise.all([getAdminOverview(), getAdminAffiliates()]);
  return <AdminView initial={overview} affiliates={affiliates} />;
}
