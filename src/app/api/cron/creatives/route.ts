import { isCronRequest } from "@/lib/cron-auth";
import { advanceOpenJobs } from "@/lib/migz/creative-jobs";

export const maxDuration = 300;

// Every 10 minutes (pg_cron): moves Higgsfield generations and Meta uploads forward. The Higgsfield
// webhook usually gets there first; this is the backstop.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const results = await advanceOpenJobs(Date.now() + 240_000);
  return Response.json(results);
}
