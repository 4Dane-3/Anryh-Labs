import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getIntakeQuestions, type Agent } from "@/lib/booking/data";
import { digestMessage, type DigestBooking } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";
import { askOutcomes } from "@/lib/dashboard/outcomes";

// Called every hour by Supabase pg_cron (supabase/migrations/20261022000000_digest_cron.sql), which sends
// `Authorization: Bearer <cron_secret from Vault>`. Each agent gets one DM per local day, at or after their digest hour.
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
      // Only the day's calls: what Migz did goes in its summary every few days, not here
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

    // Right after the morning digest (once a day): how did yesterday's calls and leads go? A separate
    // message with one-tap answers, only when there's something to ask
    try {
      const asked = await askOutcomes(agent, now);
      if (asked.asked || asked.reminded) results[agent.slug] += ` · outcomes asked ${asked.asked}, reminded ${asked.reminded}`;
    } catch (e) {
      console.error("asking for outcomes failed", agent.slug, e);
    }
  }

  return Response.json(results);
}
