import { isAnryhAdmin } from "@/lib/auth";
import { getAdminOverview } from "@/lib/admin/overview";

export const maxDuration = 60;

// Polled by the admin dashboard every 30 seconds. Staff only.
export async function GET() {
  if (!(await isAnryhAdmin())) return new Response("Not found", { status: 404 });
  return Response.json(await getAdminOverview(), { headers: { "Cache-Control": "no-store" } });
}
