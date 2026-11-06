"use client";

import { useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarPlus, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { clientLabel, type CalendarMeeting, type CrmSettings } from "@/lib/crm/types";
import { Button, Panel } from "@/components/dashboard/ui";
import { MeetingForm, type ClientOption } from "@/components/admin/crm/MeetingForm";
import { MEETING_LABEL, MEETING_TONE, TONE_DOT } from "@/components/admin/crm/shared";
import { CrmSettingsForm } from "@/components/admin/crm/CrmSettingsForm";
import { cn } from "@/lib/utils";

const CHIP = {
  neutral: "border-line bg-white/[0.04] text-fg-muted",
  accent: "border-brand/30 bg-brand/10 text-fg",
  good: "border-good/30 bg-good/10 text-fg",
  bad: "border-bad/20 bg-bad/5 text-fg-faint line-through",
} as const;

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7am–9pm
const HOUR_PX = 48;

export function CalendarView({ view, anchor, meetings, clients, settings, zoom, appUrl }: { view: "month" | "week"; anchor: string; meetings: CalendarMeeting[]; clients: ClientOption[]; settings: CrmSettings; zoom: boolean; appUrl: string }) {
  const tz = settings.timezone;
  const a = DateTime.fromISO(anchor, { zone: tz });
  const today = DateTime.now().setZone(tz).startOf("day");
  const [open, setOpen] = useState<CalendarMeeting | null>(null);
  const [newAt, setNewAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const step = view === "month" ? { months: 1 } : { weeks: 1 };
  const href = (d: DateTime, v = view) => `/admin/calendar?view=${v}&d=${d.toISODate()}`;
  const title = view === "month" ? a.toFormat("LLLL yyyy") : `${weekStart(a).toFormat("LLL d")} – ${weekStart(a).plus({ days: 6 }).toFormat(weekStart(a).month === weekStart(a).plus({ days: 6 }).month ? "d, yyyy" : "LLL d, yyyy")}`;
  const byDay = new Map<string, CalendarMeeting[]>();
  for (const m of meetings) {
    const k = DateTime.fromISO(m.starts_at).setZone(tz).toISODate()!;
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }
  const counts = meetings.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href(a.minus(step))} aria-label="Previous" className="rounded-lg border border-line p-1.5 text-fg-muted hover:bg-white/[0.06] hover:text-fg">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={href(today)} className="rounded-lg border border-line px-3 py-1 text-[13px] text-fg-muted hover:bg-white/[0.06] hover:text-fg">
            Today
          </Link>
          <Link href={href(a.plus(step))} aria-label="Next" className="rounded-lg border border-line p-1.5 text-fg-muted hover:bg-white/[0.06] hover:text-fg">
            <ChevronRight className="size-4" />
          </Link>
          <h2 className="ml-2 text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5 text-[12px]">
            {(["month", "week"] as const).map((v) => (
              <Link key={v} href={href(a, v)} className={cn("rounded-md px-2.5 py-1 capitalize", view === v ? "bg-white/[0.08] text-fg" : "text-fg-muted hover:text-fg")}>
                {v}
              </Link>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
            <Settings2 /> Meeting settings
          </Button>
          <Button size="sm" variant="primary" onClick={() => setNewAt(today.plus({ days: 1 }).set({ hour: 10 }).toISO())}>
            <CalendarPlus /> New meeting
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-fg-faint">
        {(["invited", "confirmed", "draft", "cancelled"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", TONE_DOT[MEETING_TONE[s]])} /> {MEETING_LABEL[s]} {counts[s] ?? 0}
          </span>
        ))}
        <span className="ml-auto">times in {tz.replace(/_/g, " ")}</span>
      </div>

      {view === "month" ? (
        <MonthGrid anchor={a} today={today} byDay={byDay} tz={tz} onOpen={setOpen} onNew={(d) => setNewAt(d.set({ hour: 10 }).toISO())} />
      ) : (
        <WeekGrid anchor={a} today={today} byDay={byDay} tz={tz} onOpen={setOpen} onNew={(d) => setNewAt(d.toISO())} />
      )}

      <MeetingForm open={!!open || !!newAt} onClose={() => { setOpen(null); setNewAt(null); }} settings={settings} zoom={zoom} clients={clients} meeting={open} client={open ? open.client : undefined} defaultStart={newAt ?? undefined} appUrl={appUrl} />
      <CrmSettingsForm open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} zoom={zoom} />
    </div>
  );
}

const weekStart = (d: DateTime) => d.startOf("day").minus({ days: d.weekday % 7 }); // Sunday

function Chip({ m, tz, onOpen }: { m: CalendarMeeting; tz: string; onOpen: (m: CalendarMeeting) => void }) {
  const s = DateTime.fromISO(m.starts_at).setZone(tz);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen(m);
      }}
      title={`${m.title} · ${clientLabel(m.client)} · ${MEETING_LABEL[m.status]}`}
      className={cn("flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[11px] hover:brightness-125", CHIP[MEETING_TONE[m.status]])}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[MEETING_TONE[m.status]])} />
      <span className="font-mono text-fg-faint no-underline">{s.toFormat(s.minute ? "h:mm" : "h")}{s.toFormat("a").toLowerCase()[0]}</span>
      <span className="truncate">{clientLabel(m.client)}</span>
    </button>
  );
}

function MonthGrid({ anchor, today, byDay, tz, onOpen, onNew }: { anchor: DateTime; today: DateTime; byDay: Map<string, CalendarMeeting[]>; tz: string; onOpen: (m: CalendarMeeting) => void; onNew: (d: DateTime) => void }) {
  const first = weekStart(anchor.startOf("month"));
  const weeks = Math.ceil((Math.round(anchor.startOf("month").diff(first, "days").days) + anchor.daysInMonth!) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => first.plus({ days: i }));
  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line font-mono text-[11px] text-fg-faint">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = byDay.get(d.toISODate()!) ?? [];
          const inMonth = d.month === anchor.month;
          const isToday = +d === +today;
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`New meeting on ${d.toFormat("LLLL d")}`}
              onClick={() => onNew(d)}
              onKeyDown={(e) => e.key === "Enter" && onNew(d)}
              className={cn("group min-h-[104px] cursor-pointer border-b border-r border-line p-1.5 hover:bg-white/[0.02]", (i + 1) % 7 === 0 && "border-r-0", !inMonth && "bg-black/10")}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={cn("flex size-6 items-center justify-center rounded-full text-[12px]", isToday ? "bg-brand font-semibold text-brand-fg" : inMonth ? "text-fg" : "text-fg-faint")}>{d.day}</span>
                <span className="text-[14px] leading-none text-fg-faint opacity-0 group-hover:opacity-100">+</span>
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 4).map((m) => (
                  <Chip key={m.id} m={m} tz={tz} onOpen={onOpen} />
                ))}
                {list.length > 4 && <p className="px-1 text-[11px] text-fg-faint">+{list.length - 4} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function WeekGrid({ anchor, today, byDay, tz, onOpen, onNew }: { anchor: DateTime; today: DateTime; byDay: Map<string, CalendarMeeting[]>; tz: string; onOpen: (m: CalendarMeeting) => void; onNew: (d: DateTime) => void }) {
  const start = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  return (
    <Panel className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-line">
          <div />
          {days.map((d) => (
            <div key={d.toISODate()} className="px-2 py-2 text-center">
              <p className="font-mono text-[11px] text-fg-faint">{d.toFormat("ccc")}</p>
              <p className={cn("mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm", +d === +today ? "bg-brand font-semibold text-brand-fg" : "text-fg")}>{d.day}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          <div>
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="-mt-2 pr-2 text-right font-mono text-[10px] text-fg-faint">
                {DateTime.fromObject({ hour: h }).toFormat("h a")}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const list = byDay.get(d.toISODate()!) ?? [];
            return (
              <div key={d.toISODate()} className="relative border-l border-line" style={{ height: HOURS.length * HOUR_PX }}>
                {HOURS.map((h) => (
                  <button key={h} aria-label={`New meeting ${d.toFormat("ccc LLL d")} at ${h}:00`} onClick={() => onNew(d.set({ hour: h }))} className="block w-full border-b border-line/60 hover:bg-white/[0.03]" style={{ height: HOUR_PX }} />
                ))}
                {list.map((m) => {
                  const s = DateTime.fromISO(m.starts_at).setZone(tz);
                  const e = DateTime.fromISO(m.ends_at).setZone(tz);
                  const top = Math.max(0, (s.hour + s.minute / 60 - HOURS[0]) * HOUR_PX);
                  const height = Math.max(20, e.diff(s, "hours").hours * HOUR_PX - 2);
                  return (
                    <button
                      key={m.id}
                      onClick={() => onOpen(m)}
                      style={{ top, height }}
                      className={cn("absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight hover:brightness-125", CHIP[MEETING_TONE[m.status]])}
                    >
                      <p className="truncate font-medium">{clientLabel(m.client)}</p>
                      <p className="truncate font-mono text-[10px] text-fg-faint">
                        {s.toFormat("h:mm")}–{e.toFormat("h:mm a")} · {MEETING_LABEL[m.status]}
                      </p>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
