"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { saveWorkingHours } from "@/app/dashboard/actions";
import { Button, Label, Panel, PanelHeader, Switch, inputClass } from "@/components/dashboard/ui";

type Range = { start_time: string; end_time: string };
type Settings = {
  slot_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_days_ahead: number;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const OPTIONS: Record<keyof Settings, { label: string; values: [number, string][] }> = {
  slot_minutes: { label: "Call length", values: [[15, "15 min"], [20, "20 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"]] },
  buffer_minutes: { label: "Break between calls", values: [[0, "None"], [5, "5 min"], [10, "10 min"], [15, "15 min"], [30, "30 min"]] },
  min_notice_hours: { label: "Minimum notice", values: [[0, "None"], [1, "1 hour"], [2, "2 hours"], [4, "4 hours"], [12, "12 hours"], [24, "1 day"], [48, "2 days"]] },
  max_days_ahead: { label: "How far ahead people can book", values: [[7, "1 week"], [14, "2 weeks"], [21, "3 weeks"], [30, "30 days"], [60, "60 days"]] },
};

export function HoursEditor({
  timezone,
  initialRules,
  initialSettings,
}: {
  timezone: string;
  initialRules: { weekday: number; start_time: string; end_time: string }[];
  initialSettings: Settings;
}) {
  const router = useRouter();
  const toDays = () =>
    DAYS.map((_, i) =>
      initialRules
        .filter((r) => r.weekday === i + 1)
        .map(({ start_time, end_time }) => ({ start_time, end_time })),
    );
  const [days, setDays] = useState<Range[][]>(toDays);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [status, setStatus] = useState<"idle" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (day: number, ranges: Range[]) => {
    setDays((d) => d.map((r, i) => (i === day ? ranges : r)));
    setStatus("idle");
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const rules = days.flatMap((ranges, i) => ranges.map((r) => ({ weekday: i + 1, ...r })));
      const res = await saveWorkingHours({ rules, ...settings });
      if (!res.ok) return setError(res.error);
      setStatus("saved");
      router.refresh();
    });

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Panel className="lg:col-span-3">
        <PanelHeader
          title="Weekly hours"
          description={`People can book calls during these hours (${timezone.replace(/_/g, " ")}).`}
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDays((d) => d.map((r, i) => (i < 5 ? d[0].map((x) => ({ ...x })) : r)))}
              disabled={!days[0].length}
            >
              Copy Monday to weekdays
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {DAYS.map((name, i) => {
            const ranges = days[i];
            const on = ranges.length > 0;
            return (
              <li key={name} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-start">
                <div className="flex w-36 shrink-0 items-center gap-3 pt-1.5">
                  <Switch
                    label={`Available on ${name}`}
                    checked={on}
                    onChange={(v) => update(i, v ? [{ start_time: "09:00", end_time: "17:00" }] : [])}
                  />
                  <span className={on ? "text-sm text-fg" : "text-sm text-fg-faint"}>{name}</span>
                </div>
                <div className="flex-1 space-y-2">
                  <AnimatePresence initial={false}>
                    {ranges.map((r, j) => (
                      <motion.div
                        key={j}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 overflow-hidden"
                      >
                        <input
                          type="time"
                          aria-label={`${name} start`}
                          className={`${inputClass} w-32`}
                          value={r.start_time}
                          onChange={(e) => update(i, ranges.map((x, k) => (k === j ? { ...x, start_time: e.target.value } : x)))}
                        />
                        <span className="text-fg-faint">–</span>
                        <input
                          type="time"
                          aria-label={`${name} end`}
                          className={`${inputClass} w-32`}
                          value={r.end_time}
                          onChange={(e) => update(i, ranges.map((x, k) => (k === j ? { ...x, end_time: e.target.value } : x)))}
                        />
                        <button
                          type="button"
                          aria-label="Remove these hours"
                          onClick={() => update(i, ranges.filter((_, k) => k !== j))}
                          className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
                        >
                          <X className="size-4" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {on ? (
                    <button
                      type="button"
                      onClick={() => update(i, [...ranges, { start_time: "13:00", end_time: "17:00" }])}
                      className="inline-flex items-center gap-1 text-[13px] text-fg-muted transition-colors hover:text-fg"
                    >
                      <Plus className="size-3.5" /> Add hours
                    </button>
                  ) : (
                    <p className="pt-1.5 text-[13px] text-fg-faint">Unavailable</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="space-y-3 lg:col-span-2">
        <Panel>
          <PanelHeader title="Booking rules" />
          <div className="space-y-4 px-5 py-4">
            {(Object.keys(OPTIONS) as (keyof Settings)[]).map((key) => (
              <div key={key}>
                <Label htmlFor={key}>{OPTIONS[key].label}</Label>
                <select
                  id={key}
                  className={inputClass}
                  value={settings[key]}
                  onChange={(e) => {
                    setSettings((s) => ({ ...s, [key]: Number(e.target.value) }));
                    setStatus("idle");
                  }}
                >
                  {/* Keep a custom saved value selectable even if it's not a preset */}
                  {!OPTIONS[key].values.some(([v]) => v === settings[key]) && (
                    <option value={settings[key]}>{settings[key]}</option>
                  )}
                  {OPTIONS[key].values.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save hours"}
          </Button>
          <AnimatePresence>
            {status === "saved" && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="text-[13px] text-good"
              >
                Saved. Your page shows the new times.
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
    </div>
  );
}
