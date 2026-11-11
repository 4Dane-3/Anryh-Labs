"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveTextSettings, setVideoApproval } from "@/app/dashboard/creatives/actions";
import { Panel, Switch as Toggle } from "@/components/dashboard/ui";

/** The switch for approving Migz's videos first, and the way into anything waiting. */
export function VideoApprovals({ on, waiting, reviewUrl, smsPhone, smsOn }: { on: boolean; waiting: number; reviewUrl: string | null; smsPhone: string; smsOn: boolean }) {
  const [value, setValue] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [phone, setPhone] = useState(smsPhone);
  const [texting, setTexting] = useState(smsOn);
  const [saved, setSaved] = useState(false);
  const saveText = () =>
    start(async () => {
      setSaved(false);
      setError(null);
      const r = await saveTextSettings(phone, texting);
      if (r.ok) setSaved(true);
      else setError(r.error ?? "Couldn't save that.");
    });
  const change = (next: boolean) => {
    setValue(next);
    setError(null);
    start(async () => {
      const r = await setVideoApproval(next);
      if (!r.ok) {
        setValue(!next);
        setError(r.error ?? "Couldn't save that.");
      }
    });
  };
  return (
    <Panel className="mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Approve videos before they go live</h2>
          <p className="mt-1 text-sm text-fg-muted">Migz AI emails, Slacks or texts you a preview of each new video. Nothing runs until you approve it.</p>
        </div>
        <Toggle checked={value} onChange={change} label="Approve videos before they go live" disabled={busy} />
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <label className="flex items-start gap-2 text-sm text-fg">
          <input type="checkbox" checked={texting} onChange={(e) => setTexting(e.target.checked)} className="mt-0.5" />
          <span>Text me about my ads, and let me text Migz AI back. Message and data rates may apply. Reply STOP any time.</span>
        </label>
        <div className="mt-2 flex gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Mobile number" aria-label="Mobile number" className="w-48 rounded-lg border border-line bg-ink-high px-3 py-1.5 text-sm text-fg" />
          <button type="button" onClick={saveText} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg disabled:opacity-50">
            Save
          </button>
          {saved && <span className="self-center text-sm text-fg-muted">Saved</span>}
        </div>
      </div>
      <Link href="/dashboard/creatives/presenter" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
        Put yourself in your videos
      </Link>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {waiting > 0 && reviewUrl && (
        <a href={reviewUrl} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
          Review {waiting} waiting video{waiting === 1 ? "" : "s"}
        </a>
      )}
    </Panel>
  );
}
