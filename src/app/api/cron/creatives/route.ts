import { isCronRequest } from "@/lib/cron-auth";
import { advanceOpenJobs } from "@/lib/migz/creative-jobs";
import { notifyAdReviews } from "@/lib/migz/notify";

export const maxDuration = 300;

// Every 10 minutes (pg_cron): moves Higgsfield generations and Meta uploads forward. The Higgsfield
// webhook usually gets there first; this is the backstop. Then tells agents in Slack which new ads Meta
// finished reviewing.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const results = await advanceOpenJobs(Date.now() + 240_000);
  const reviews = await notifyAdReviews(Date.now() + 40_000).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  return Response.json({ jobs: results, reviews });
}
