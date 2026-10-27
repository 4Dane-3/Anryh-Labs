import { isCronRequest } from "@/lib/cron-auth";
import { nightlyShift } from "@/lib/migz/nightly";

export const maxDuration = 300;

// Hourly (pg_cron): every other evening, each agent whose local clock has reached 9pm gets a summary of the last two days in Slack,
// and Migz's notebook of thoughts moves on with it.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await nightlyShift(Date.now() + 240_000));
}
