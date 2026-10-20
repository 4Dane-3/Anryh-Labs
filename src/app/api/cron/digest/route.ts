import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getIntakeQuestions, type Agent } from "@/lib/booking/data";
import { digestMessage, type DigestBooking } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";

// Runs every hour (see vercel.json). Each agent gets one DM per local day, at or after their digest hour.
// Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: agents } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("active", true)
    .not("slack_user_id", "is", null);

  const results: Record<string, string> = {};

  for (const agent of (agents ?? []) as Agent[]) {
    const now = DateTime.now().setZone(agent.timezone);
    const today = now.toISODate()!;

    if (now.hour < agent.digest_hour || agent.last_digest_date === today) {
      results[agent.slug] = "skipped";
      continue;
    }

    // Claim today's digest first so overlapping runs can't double-send
    const { data: claimed } = await supabaseAdmin
      .from("agents")
      .update({ last_digest_date: today })
      .eq("id", agent.id)
      .or(`last_digest_date.is.null,last_digest_date.neq.${today}`)
      .select("id");
    if (!claimed?.length) {
      results[agent.slug] = "skipped";
      continue;
    }

    try {
      const { data: rows } = await supabaseAdmin
        .from("bookings")
        .select("name, email, phone, starts_at, intake_responses(answers)")
        .eq("agent_id", agent.id)
        .eq("status", "confirmed")
        .gte("starts_at", now.startOf("day").toUTC().toISO()!)
        .lt("starts_at", now.endOf("day").toUTC().toISO()!)
        .order("starts_at");

      const bookings: DigestBooking[] = (rows ?? []).map((r) => {
        const intake = Array.isArray(r.intake_responses)
          ? r.intake_responses[0]
          : r.intake_responses;
        return {
          name: r.name,
          email: r.email,
          phone: r.phone,
          starts_at: r.starts_at,
          intake: intake?.answers ?? null,
        };
      });

      const order = (await getIntakeQuestions(agent.id)).map((q) => q.key);
      await sendSlackMessage(agent.slack_user_id!, digestMessage(agent, bookings, now, order));
      results[agent.slug] = `sent (${bookings.length})`;
    } catch (e) {
      // Release the claim so the next hourly run retries
      await supabaseAdmin
        .from("agents")
        .update({ last_digest_date: agent.last_digest_date })
        .eq("id", agent.id);
      console.error("digest failed", agent.slug, e);
      results[agent.slug] = "failed";
    }
  }

  return Response.json(results);
}
