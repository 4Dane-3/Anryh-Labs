"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { updateSettings } from "@/app/dashboard/actions";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { Button, Label, Panel, PanelHeader, inputClass } from "@/components/dashboard/ui";

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

export function PasswordForm({ email, devLogin }: { email: string; devLogin: boolean }) {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      if (password.length < 8) return setError("Use at least 8 characters.");
      const { error } = await createSupabaseBrowser().auth.updateUser({ password });
      if (error) return setError(error.message);
      setPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  return (
    <Panel>
      <PanelHeader title="Account" description={`Signed in as ${email}`} />
      <div className="px-5 py-5">
        <Label htmlFor="new-password">New password</Label>
        <div className="flex gap-2">
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={password}
            disabled={devLogin}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button onClick={save} disabled={pending || !password || devLogin}>
            Update
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {devLogin && <p className="text-[12px] text-fg-faint">Not available in dev login mode. Sign in for real to change it.</p>}
          {error && <p className="text-[13px] text-bad">{error}</p>}
          <Saved show={saved} />
        </div>
      </div>
    </Panel>
  );
}
