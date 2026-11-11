"use client";

import { useState, useTransition } from "react";
import type { ReviewVideo } from "@/lib/migz/video-review";
import { approveAllVideos, approveVideo, askForChanges } from "./actions";

type Result = { ok: true; message: string } | { ok: false; error: string };

function Card({ token, video, run, busy }: { token: string; video: ReviewVideo; run: (f: () => Promise<Result>) => void; busy: boolean }) {
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {video.url ? (
        <video src={video.url} controls playsInline preload="metadata" className="aspect-[9/16] w-full bg-slate-900" />
      ) : (
        <p className="p-6 text-sm text-slate-500">This video couldn&apos;t be loaded. Refresh the page to try again.</p>
      )}
      <div className="p-5">
        <h2 className="text-base font-semibold">{video.label}</h2>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Text on the ad</p>
        <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{video.primaryText}</p>
        <p className="mt-2 text-[15px] font-semibold text-slate-900">{video.headline}</p>
        {changing ? (
          <div className="mt-4">
            <label htmlFor={`note-${video.id}`} className="text-sm font-medium text-slate-700">
              What should change?
            </label>
            <textarea id={`note-${video.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-base text-slate-900" />
            <div className="mt-3 flex gap-2">
              <button disabled={busy} onClick={() => run(() => askForChanges(token, video.id, note))} className="flex-1 rounded-full bg-slate-900 px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60">
                Send
              </button>
              <button disabled={busy} onClick={() => setChanging(false)} className="rounded-full border border-slate-300 px-4 py-3 text-[15px] font-semibold text-slate-700 disabled:opacity-60">
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-2">
            <button disabled={busy} onClick={() => run(() => approveVideo(token, video.id))} className="flex-1 rounded-full bg-slate-900 px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60">
              Approve
            </button>
            <button disabled={busy} onClick={() => setChanging(true)} className="flex-1 rounded-full border border-slate-300 px-4 py-3 text-[15px] font-semibold text-slate-700 disabled:opacity-60">
              Request changes
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function ReviewList({ token, videos }: { token: string; videos: ReviewVideo[] }) {
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (f: () => Promise<Result>) =>
    start(async () => {
      const r = await f();
      setNotice(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  return (
    <div className="mt-6 space-y-5">
      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {notice.text}
        </p>
      )}
      {videos.map((v) => (
        <Card key={v.id} token={token} video={v} run={run} busy={busy} />
      ))}
      {videos.length > 1 && (
        <button disabled={busy} onClick={() => run(() => approveAllVideos(token))} className="w-full rounded-full bg-slate-900 px-5 py-3.5 text-[15px] font-semibold text-white disabled:opacity-60">
          Approve all {videos.length}
        </button>
      )}
    </div>
  );
}
