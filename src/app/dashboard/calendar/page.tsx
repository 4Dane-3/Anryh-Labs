import { DateTime } from "luxon";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getIntakeQuestions } from "@/lib/booking/data";
import { getBookingsBetween } from "@/lib/dashboard/queries";
import { PageHeader, Tabs } from "@/components/dashboard/ui";
import { WeekCalendar } from "@/components/dashboard/WeekCalendar";
import { HoursEditor } from "@/components/dashboard/HoursEditor";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; tab?: string }>;
}) {
  const agent = await requireAgent();
  const { week, tab = "schedule" } = await searchParams;

  const picked = week ? DateTime.fromISO(week, { zone: agent.timezone }) : null;
  const weekStart = (picked?.isValid ? picked : DateTime.now().setZone(agent.timezone)).startOf("week");

  const [bookings, { data: rules }, questions] = await Promise.all([
    getBookingsBetween(agent.id, weekStart.toUTC().toISO()!, weekStart.plus({ weeks: 1 }).toUTC().toISO()!),
    supabaseAdmin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("agent_id", agent.id)
      .order("weekday")
      .order("start_time"),
    getIntakeQuestions(agent.id),
  ]);

  const hhmm = (t: string) => t.slice(0, 5);
  const cleanRules = (rules ?? []).map((r) => ({
    weekday: r.weekday,
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
  }));

  return (
    <>
      <PageHeader title="Calendar" description="Your booked calls, and the hours people can book you." />
      <Tabs
        id="calendar"
        active={tab === "hours" ? "hours" : "schedule"}
        tabs={[
          { key: "schedule", label: "Schedule", href: `/dashboard/calendar${week ? `?week=${week}` : ""}` },
          { key: "hours", label: "Working hours", href: "/dashboard/calendar?tab=hours" },
        ]}
      />

      {tab === "hours" ? (
        <HoursEditor
          timezone={agent.timezone}
          initialRules={cleanRules}
          initialSettings={{
            slot_minutes: agent.slot_minutes,
            slot_interval_minutes: agent.slot_interval_minutes ?? 0,
            buffer_minutes: agent.buffer_minutes,
            min_notice_hours: agent.min_notice_hours,
            max_days_ahead: agent.max_days_ahead,
          }}
        />
      ) : (
        <WeekCalendar
          weekStart={weekStart.toISODate()!}
          timezone={agent.timezone}
          bookings={bookings.filter((b) => b.status === "confirmed")}
          rules={cleanRules}
          questionOrder={questions.map((q) => q.key)}
        />
      )}
    </>
  );
}
