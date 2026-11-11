"use client";

import { useState, useTransition } from "react";
import { setVideoApproval } from "@/app/dashboard/creatives/actions";
import { Panel, Switch as Toggle } from "@/components/dashboard/ui";

/** The switch for approving Migz's videos first, and the way into anything waiting. */
export function VideoApprovals({ on, waiting, reviewUrl }: { on: boolean; waiting: number; reviewUrl: string | null }) {
  const [value, setValue] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
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
          <p className="mt-1 text-sm text-fg-muted">Migz AI emails and Slacks you a preview of each new video. Nothing runs until you approve it.</p>
        </div>
        <Toggle checked={value} onChange={change} label="Approve videos before they go live" disabled={busy} />
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {waiting > 0 && reviewUrl && (
        <a href={reviewUrl} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
          Review {waiting} waiting video{waiting === 1 ? "" : "s"}
        </a>
      )}
    </Panel>
  );
}
