import { isCronRequest } from "@/lib/cron-auth";
import { researchShift } from "@/lib/migz/research";
import { findWinningAds } from "@/lib/migz/team/finder";

export const maxDuration = 300;

// Every 10 minutes (pg_cron): the research shift moves each agent's current research cycle one step
// (market → history → clerk → memory). Overnight, the ad finder also runs one search pass per tick.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const [shift, finder] = await Promise.all([
    researchShift(Date.now() + 240_000),
    findWinningAds().catch((e) => ({ status: "failed" as const, error: e instanceof Error ? e.message.slice(0, 200) : String(e) })),
  ]);
  return Response.json({ ...shift, ad_finder: finder });
}
