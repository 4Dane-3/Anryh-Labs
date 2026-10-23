import { isCronRequest } from "@/lib/cron-auth";
import { researchShift } from "@/lib/migz/research";

export const maxDuration = 300;

// Every 10 minutes (pg_cron): the research shift moves each agent's current research cycle one step
// (market → history → clerk → memory).
export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await researchShift(Date.now() + 240_000));
}
