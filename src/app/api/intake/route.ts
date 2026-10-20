import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBookingByToken } from "@/lib/booking/data";
import { parseIntake } from "@/lib/booking/validate";
import { intakeCompletedMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";

  const booking = await getBookingByToken(token);
  if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });

  const parsed = parseIntake(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from("intake_responses")
    .select("booking_id")
    .eq("booking_id", booking.id)
    .maybeSingle();

  const { error } = await supabaseAdmin.from("intake_responses").upsert({
    booking_id: booking.id,
    ...parsed.data,
    submitted_at: new Date().toISOString(),
  });

  if (error) {
    console.error("intake upsert failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Notify the agent on the first submission only, not on edits
  const agent = booking.agents;
  if (!existing && agent.slack_user_id) {
    after(async () => {
      try {
        await sendSlackMessage(
          agent.slack_user_id!,
          intakeCompletedMessage(
            agent,
            {
              name: booking.name,
              email: booking.email,
              phone: booking.phone,
              starts_at: booking.starts_at,
            },
            parsed.data,
          ),
        );
      } catch (e) {
        console.error("slack notify failed", e);
      }
    });
  }

  return Response.json({ ok: true });
}
