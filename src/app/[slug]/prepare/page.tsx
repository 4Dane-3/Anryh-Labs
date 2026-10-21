import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBookingByToken, getIntakeQuestions } from "@/lib/booking/data";
import type { IntakeAnswers } from "@/lib/booking/questions";
import { PrepareFlow } from "@/components/booking/PrepareFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You're booked",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ b?: string; new?: string }>;
};

export default async function PreparePage({ params, searchParams }: Props) {
  const [{ slug }, { b: token = "", new: justBooked }] = await Promise.all([
    params,
    searchParams,
  ]);

  const booking = await getBookingByToken(token);
  if (!booking || booking.agents.slug !== slug) notFound();

  const agent = booking.agents;

  const [{ data: intake }, questions] = await Promise.all([
    supabaseAdmin
      .from("intake_responses")
      .select("answers, completed_at")
      .eq("booking_id", booking.id)
      .maybeSingle(),
    getIntakeQuestions(agent.id),
  ]);

  const answers = (intake?.answers ?? {}) as IntakeAnswers;
  const initial = Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.value]));

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <PrepareFlow
        token={booking.token}
        agentName={agent.full_name}
        startsAt={booking.starts_at}
        questions={questions.filter((q) => q.enabled)}
        initial={initial}
        completed={!!intake?.completed_at}
        justBooked={justBooked === "1"}
      />
    </div>
  );
}
