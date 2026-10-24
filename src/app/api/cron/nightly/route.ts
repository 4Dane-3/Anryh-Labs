import { isCronRequest } from "@/lib/cron-auth";
import { nightlyShift } from "@/lib/migz/nightly";

export const maxDuration = 300;

// Hourly (pg_cron): each agent whose local clock has reached 9pm gets one summary of their day in Slack,
// and Migz's notebook of thoughts moves on a night.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await nightlyShift(Date.now() + 240_000));
}
