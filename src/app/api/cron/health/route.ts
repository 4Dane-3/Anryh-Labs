import { isCronRequest } from "@/lib/cron-auth";
import { scanAll } from "@/lib/admin/health";

export const maxDuration = 300;

// Every 10 minutes (pg_cron): checks every agent's account for problems, keeps the admin dashboard's
// alerts current, and pings staff in Slack about new ones.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await scanAll(Date.now() + 240_000));
}
