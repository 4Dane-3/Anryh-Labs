import { after } from "next/server";
import { getCurrentAgent } from "@/lib/auth";
import { getLiveStats, pulseIfDue } from "@/lib/migz/live";

export const maxDuration = 60;

// Polled about once a minute while the Brain page is open: today's numbers from Meta. After answering,
// it runs Migz's live check-in if one is due (every few minutes, never during a review).
export async function GET() {
  const agent = await getCurrentAgent();
  if (!agent) return new Response("Unauthorized", { status: 401 });
  const stats = await getLiveStats(agent);
  after(() => pulseIfDue(agent).catch((e) => console.error("brain pulse failed", e instanceof Error ? e.message : e)));
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
