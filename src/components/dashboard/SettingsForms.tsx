"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { setGhostBookings, setMigzMode, updateSettings } from "@/app/dashboard/actions";
import { Button, Label, Panel, PanelHeader, Switch, inputClass } from "@/components/dashboard/ui";

const TIMEZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;

const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;

function Saved({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-good">
          Saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function NotificationSettings({
  initial,
}: {
  initial: { slack_user_id: string; timezone: string; digest_hour: number };
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await updateSettings(form);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });

  const knownZone = TIMEZONES.some(([z]) => z === form.timezone);

  return (
    <Panel>
      <PanelHeader title="Notifications" description="Where we tell you about new bookings, and when you get your daily summary." />
      <div className="space-y-5 px-5 py-5">
        <div>
          <Label htmlFor="slack">Slack member ID</Label>
          <input
            id="slack"
            className={`${inputClass} font-mono`}
            placeholder="U04ABCD1234"
            value={form.slack_user_id}
            onChange={(e) => setForm({ ...form, slack_user_id: e.target.value })}
          />
          <p className="mt-1.5 text-[12px] text-fg-faint">
            In Slack, click your profile picture → Profile → ⋮ → Copy member ID.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tz">Your timezone</Label>
            <select id="tz" className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {!knownZone && <option value={form.timezone}>{form.timezone}</option>}
              {TIMEZONES.map(([z, l]) => (
                <option key={z} value={z}>
                  {l} ({z.split("/")[1].replace("_", " ")})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="digest">Morning summary at</Label>
            <select
              id="digest"
              className={inputClass}
              value={form.digest_hour}
              onChange={(e) => setForm({ ...form, digest_hour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[12px] text-fg-faint">
          Changing your timezone also changes when your working hours apply.
        </p>
        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <Button variant="primary" onClick={save} disabled={pending}>
          Save
        </Button>
        <Saved show={saved} />
      </div>
    </Panel>
  );
}

const MIGZ_MODES = [
  {
    value: "approve",
    label: "Ask me first",
    detail: "Migz suggests changes and you approve each one from your Overview. Best while you get to know it.",
  },
  {
    value: "auto",
    label: "Automatic",
    detail: "Migz makes changes as results come in, within your daily budget and its safety limits. Everything is logged.",
  },
  { value: "off", label: "Off", detail: "Migz stops reviewing your ads. Running ads keep running as they are." },
] as const;

export function MigzModeForm({ mode }: { mode: "off" | "approve" | "auto" }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: typeof value) =>
    startTransition(async () => {
      const previous = value;
      setValue(next);
      setError(null);
      const res = await setMigzMode(next);
      if (!res.ok) {
        setValue(previous);
        setError(res.error);
      }
      router.refresh();
    });

  return (
    <Panel>
      <PanelHeader title="Migz AI" description="How much Migz does on its own when it reviews your ads, several times a day." />
      <div role="radiogroup" aria-label="Migz mode" className="space-y-2 px-5 py-5">
        {MIGZ_MODES.map((m) => {
          const selected = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => choose(m.value)}
              className={`relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected ? "border-brand/50 bg-brand/[0.06]" : "border-line hover:border-line-strong"
              }`}
            >
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-brand" : "border-line-strong"
                }`}
              >
                {selected && <motion.span layoutId="migz-mode-dot" className="size-2 rounded-full bg-brand" />}
              </span>
              <span>
                <span className="block text-sm font-medium text-fg">{m.label}</span>
                <span className="mt-0.5 block text-[13px] text-fg-muted">{m.detail}</span>
              </span>
            </button>
          );
        })}
        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
    </Panel>
  );
}

/** Ghost bookings: some open times are held back on the booking page so the calendar looks busy. */
export function GhostBookingsForm({ on }: { on: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toggle = (next: boolean) =>
    startTransition(async () => {
      setValue(next);
      setError(null);
      const res = await setGhostBookings(next);
      if (!res.ok) {
        setValue(!next);
        setError(res.error);
      }
      router.refresh();
    });
  return (
    <Panel>
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Ghost bookings</h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Holds back some of your open times over the next two weeks (more in the next few days), so your booking page looks like a busy agent&apos;s. Held times just aren&apos;t offered, like a taken slot. Every day keeps at least two times, and nothing is added to your calendar or clients.
          </p>
          {error && <p className="mt-1 text-[13px] text-bad">{error}</p>}
        </div>
        <Switch checked={value} onChange={toggle} label="Ghost bookings" disabled={pending} />
      </div>
    </Panel>
  );
}
