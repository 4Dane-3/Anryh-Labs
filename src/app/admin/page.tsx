import { getAdminOverview } from "@/lib/admin/overview";
import { AdminView } from "@/components/admin/AdminView";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  return <AdminView initial={await getAdminOverview()} />;
}
