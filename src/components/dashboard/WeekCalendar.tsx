"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ClientBooking } from "@/lib/dashboard/queries";
import { ClientDrawer } from "@/components/dashboard/ClientDrawer";
import { cn } from "@/lib/utils";

type Rule = { weekday: number; start_time: string; end_time: string };

const HOUR_H = 52;
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const noopSubscribe = () => () => {};

export function WeekCalendar({
  weekStart,
  timezone,
  bookings,
  rules,
  questionOrder,
}: {
  weekStart: string;
  timezone: string;
  bookings: ClientBooking[];
  rules: Rule[];
  questionOrder: string[];
}) {
  const [selected, setSelected] = useState<ClientBooking | null>(null);
  const close = useCallback(() => setSelected(null), []);
  // "Now" only exists on the client, so the server and client render the same markup
  const nowIso = useSyncExternalStore(noopSubscribe, () => new Date().toISOString().slice(0, 16), () => null);
  const now = nowIso ? DateTime.fromISO(nowIso, { zone: "utc" }).setZone(timezone) : null;

  const start = DateTime.fromISO(weekStart, { zone: timezone });
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const prev = start.minus({ weeks: 1 }).toISODate();
  const next = start.plus({ weeks: 1 }).toISODate();

  const local = bookings.map((b) => ({
    booking: b,
    start: DateTime.fromISO(b.starts_at, { zone: timezone }),
    end: DateTime.fromISO(b.ends_at, { zone: timezone }),
  }));

  // Show at least 8am–6pm, stretched to cover working hours and any calls outside them
  const startMins = [8 * 60, ...rules.map((r) => minutesOf(r.start_time)), ...local.map((l) => l.start.hour * 60)];
  const endMins = [18 * 60, ...rules.map((r) => minutesOf(r.end_time)), ...local.map((l) => l.end.hour * 60 + l.end.minute)];
  const firstHour = Math.floor(Math.min(...startMins) / 60);
  const lastHour = Math.ceil(Math.max(...endMins) / 60);
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const y = (mins: number) => ((mins - firstHour * 60) / 60) * HOUR_H;

  const rangeLabel =
    start.month === start.plus({ days: 6 }).month
      ? `${start.toFormat("LLL d")} – ${start.plus({ days: 6 }).toFormat("d, yyyy")}`
      : `${start.toFormat("LLL d")} – ${start.plus({ days: 6 }).toFormat("LLL d, yyyy")}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={`/dashboard/calendar?week=${prev}`}
            scroll={false}
            aria-label="Previous week"
            className="rounded-lg border border-line p-1.5 text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={`/dashboard/calendar?week=${next}`}
            scroll={false}
            aria-label="Next week"
            className="rounded-lg border border-line p-1.5 text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <ChevronRight className="size-4" />
          </Link>
          <h2 className="ml-3 text-sm font-semibold">{rangeLabel}</h2>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-fg-muted">
          <span>
            {bookings.length} call{bookings.length === 1 ? "" : "s"} this week
          </span>
          <Link
            href="/dashboard/calendar"
            scroll={false}
            className="rounded-lg border border-line px-3 py-1.5 transition-colors hover:border-line-strong hover:text-fg"
          >
            Today
          </Link>
        </div>
      </div>

      {/* Desktop: time grid */}
      <motion.div
        key={weekStart}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="hidden overflow-hidden rounded-xl border border-line bg-ink-raised md:block"
      >
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-line">
          <div />
          {days.map((d) => {
            const isToday = now?.hasSame(d, "day");
            return (
              <div key={d.toISODate()} className="border-l border-line px-2 py-2.5 text-center">
                <div className="text-[11px] uppercase tracking-wide text-fg-faint">{d.toFormat("ccc")}</div>
                <div
                  className={cn(
                    "mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                    isToday && "bg-brand text-brand-fg",
                  )}
                >
                  {d.day}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          <div className="relative" style={{ height: hours.length * HOUR_H }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-fg-faint"
                style={{ top: y(h * 60) }}
              >
                {h > firstHour && DateTime.fromObject({ hour: h }).toFormat("h a")}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const dayRules = rules.filter((r) => r.weekday === d.weekday);
            const dayBookings = local.filter((l) => l.start.hasSame(d, "day"));
            const isToday = now?.hasSame(d, "day");
            const nowMins = now ? now.hour * 60 + now.minute : 0;
            return (
              <div key={d.toISODate()} className="relative border-l border-line" style={{ height: hours.length * HOUR_H }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: y(h * 60) }} />
                ))}
                {dayRules.map((r) => (
                  <div
                    key={r.start_time}
                    className="absolute inset-x-0 bg-white/[0.025]"
                    style={{ top: y(minutesOf(r.start_time)), height: y(minutesOf(r.end_time)) - y(minutesOf(r.start_time)) }}
                  />
                ))}
                {isToday && nowMins >= firstHour * 60 && nowMins <= lastHour * 60 && (
                  <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: y(nowMins) }}>
                    <span className="-ml-1 size-2 rounded-full bg-bad" />
                    <span className="h-px flex-1 bg-bad" />
                  </div>
                )}
                {dayBookings.map(({ booking, start: s, end: e }, i) => {
                  const top = y(s.hour * 60 + s.minute);
                  const height = Math.max(22, y(e.hour * 60 + e.minute) - top - 2);
                  return (
                    <motion.button
                      key={booking.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, delay: i * 0.03 }}
                      onClick={() => setSelected(booking)}
                      className="absolute inset-x-1 z-20 overflow-hidden rounded-md border-l-2 border-brand bg-brand/15 px-2 py-1 text-left transition-colors hover:bg-brand/25"
                      style={{ top: top + 1, height }}
                    >
                      <div className="truncate text-[12px] font-medium text-fg">{booking.name}</div>
                      {height > 34 && <div className="text-[11px] text-fg-muted">{s.toFormat("h:mm a")}</div>}
                    </motion.button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Mobile: agenda list */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const dayBookings = local.filter((l) => l.start.hasSame(d, "day"));
          return (
            <div key={d.toISODate()}>
              <div className={cn("mb-2 text-[13px] font-medium", now?.hasSame(d, "day") ? "text-brand" : "text-fg-muted")}>
                {d.toFormat("cccc, LLL d")}
              </div>
              {dayBookings.length ? (
                <div className="space-y-2">
                  {dayBookings.map(({ booking, start: s }) => (
                    <button
                      key={booking.id}
                      onClick={() => setSelected(booking)}
                      className="flex w-full items-center gap-3 rounded-lg border border-line bg-ink-raised px-4 py-3 text-left"
                    >
                      <span className="w-16 shrink-0 text-[13px] tabular-nums text-fg-muted">{s.toFormat("h:mm a")}</span>
                      <span className="truncate text-sm font-medium">{booking.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-fg-faint">No calls</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-fg-faint">
        Times in {timezone.replace(/_/g, " ")}. Shaded areas are your working hours.
      </p>

      <ClientDrawer booking={selected} timezone={timezone} questionOrder={questionOrder} onClose={close} />
    </>
  );
}
