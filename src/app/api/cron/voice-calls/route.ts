import { isCronRequest } from "@/lib/cron-auth";
import { placeDueCalls } from "@/lib/voice/dial";
import { placeDueCheckins } from "@/lib/roofing/checkin";

// Every minute (pg_cron): the voice agent's calls that are due, the 8am first calls for leads that came in
// overnight and the no-answer retries, and the post-job check-in calls. Instant calls never wait for this.
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronRequest(req)) return new Response("Unauthorized", { status: 401 });
  const [placed, checkins] = await Promise.all([placeDueCalls(), placeDueCheckins()]);
  return Response.json({ placed, checkins });
}
