import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBookingByToken, getIntakeQuestions } from "@/lib/booking/data";
import { preBookingQuestions, type IntakeAnswers } from "@/lib/booking/questions";

// What a partner site's "help them prepare" page needs for one booking: when the call is, the agent's
// optional questions and anything already answered. The token is the booking's secret link (the same one
// the confirmation email carries); answers are saved through /api/intake.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const booking = await getBookingByToken(token);
  if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });
  const agent = booking.agents;
  const [{ data: intake }, questions] = await Promise.all([
    supabaseAdmin.from("intake_responses").select("answers, completed_at").eq("booking_id", booking.id).maybeSingle(),
    getIntakeQuestions(agent.id),
  ]);
  const answers = (intake?.answers ?? {}) as IntakeAnswers;
  return Response.json(
    {
      slug: agent.slug,
      agentName: agent.full_name,
      startsAt: booking.starts_at,
      slotMinutes: agent.slot_minutes,
      questions: questions.filter((q) => q.enabled),
      answers: Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.value])),
      completed: !!intake?.completed_at,
      answeredAtBooking: preBookingQuestions(questions, agent.required_intake_steps ?? []).map((q) => q.key),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
