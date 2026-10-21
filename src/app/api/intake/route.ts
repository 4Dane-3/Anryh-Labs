import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBookingByToken, getIntakeQuestions } from "@/lib/booking/data";
import { parseAnswers } from "@/lib/booking/validate";
import { intakeCompletedMessage } from "@/lib/booking/format";
import { sendSlackMessage } from "@/lib/slack";

// Called after every step (autosave) and once more with `final: true` on the last step.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const final = body?.final === true;

  const booking = await getBookingByToken(token);
  if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });

  const questions = await getIntakeQuestions(booking.agent_id);
  const parsed = parseAnswers(body?.answers, questions);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from("intake_responses")
    .select("completed_at")
    .eq("booking_id", booking.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const alreadyCompleted = existing?.completed_at ?? null;

  const { error } = await supabaseAdmin.from("intake_responses").upsert({
    booking_id: booking.id,
    answers: parsed.data,
    submitted_at: now,
    completed_at: alreadyCompleted ?? (final ? now : null),
  });

  if (error) {
    console.error("intake upsert failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  // Notify the agent once, when the prospect first finishes the last step (not on autosaves or edits)
  const agent = booking.agents;
  if (final && !alreadyCompleted && agent.slack_user_id) {
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
