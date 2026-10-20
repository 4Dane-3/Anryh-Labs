import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBookingByToken } from "@/lib/booking/data";
import { IntakeForm } from "@/components/booking/IntakeForm";
import { BookedTime } from "@/components/booking/BookedTime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You're booked",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ b?: string }>;
};

export default async function PreparePage({ params, searchParams }: Props) {
  const [{ slug }, { b: token = "" }] = await Promise.all([params, searchParams]);

  const booking = await getBookingByToken(token);
  if (!booking || booking.agents.slug !== slug) notFound();

  const agent = booking.agents;
  const firstName = agent.full_name.split(" ")[0];

  const { data: intake } = await supabaseAdmin
    .from("intake_responses")
    .select("*")
    .eq("booking_id", booking.id)
    .maybeSingle();

  // Strip nulls/metadata so the form only gets string answers
  const initial = intake
    ? Object.fromEntries(
        Object.entries(intake).filter(
          ([k, v]) => typeof v === "string" && k !== "booking_id" && k !== "submitted_at",
        ),
      )
    : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-green-600" />
            <div>
              <h1 className="text-xl font-bold">You&apos;re booked with {agent.full_name}</h1>
              <p className="mt-1 text-slate-600">
                <BookedTime iso={booking.starts_at} />
              </p>
              <a
                href={`/api/bookings/ics?token=${booking.token}`}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-900"
              >
                <CalendarPlus className="size-4" /> Add to my calendar
              </a>
            </div>
          </div>
        </div>

        <IntakeForm token={booking.token} agentFirstName={firstName} initial={initial} />
      </main>
    </div>
  );
}
