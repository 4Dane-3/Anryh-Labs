"use client";

import { useState, useTransition } from "react";
import { createCreativeUpload } from "@/app/dashboard/actions";
import { addPresenterFile, getFilmScript, makePresenterVideo, savePresenter } from "@/app/dashboard/creatives/actions";
import { Panel } from "@/components/dashboard/ui";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";

type Mode = "film" | "ai" | "none";
export type PresenterInitial = {
  mode: Mode;
  towns: string;
  onCameraName: string;
  onCameraRole: string;
  onCameraVoice: "male" | "female";
  onCameraPronunciation: string;
  look: { status: "processing" | "completed" | "failed" | null; preview: string | null };
  consentName: string;
  consented: boolean;
  photos: number;
  jobs: number;
  film: boolean;
  voice: boolean;
};
const ROLES = ["Owner", "Co-owner", "Project manager", "Sales manager", "Estimator"];

const MODES: { key: Mode; title: string; body: string; recommended?: boolean }[] = [
  { key: "ai", title: "AI version of you", body: "Upload one clear photo. Migz makes you talk to the camera in your own voice, lips matched, then edits it with captions, cards and sound.", recommended: true },
  { key: "film", title: "Film it yourself", body: "Migz writes the script, you record 30 seconds on your phone, Migz does the edit." },
  { key: "none", title: "No person", body: "Job photos and video with a voiceover." },
];
const field = "mt-1 w-full rounded-lg border border-line bg-ink-high px-3 py-2 text-sm text-fg";

function Upload({ label, accept, kind, have, onDone, onError }: { label: string; accept: string; kind: "photo" | "job" | "film" | "voice"; have: string; onDone: () => void; onError: (e: string) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const send = async (file: File) => {
    try {
      setProgress(0);
      const started = await createCreativeUpload({ name: file.name, type: file.type, size: file.size });
      if (!started.ok) throw new Error(started.error);
      await uploadToSignedUrl(started.signedUrl, file, setProgress);
      const saved = await addPresenterFile(kind, started.path);
      if (!saved.ok) throw new Error(saved.error);
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  };
  return (
    <label className="block text-sm text-fg">
      {label} <span className="text-fg-muted">{progress !== null ? `${Math.round(progress * 100)}%` : have}</span>
      <input type="file" accept={accept} className="mt-1 block text-sm text-fg-muted" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
    </label>
  );
}

/** `inSetup`: the Start here step, which saves who's on camera and their photo but never makes a video. */
export function PresenterSetup({ initial, inSetup, onSaved }: { initial: PresenterInitial; inSetup?: boolean; onSaved?: () => void }) {
  const [v, setV] = useState<PresenterInitial>(initial);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (patch: Partial<PresenterInitial>) => setV((c) => ({ ...c, ...patch }));
  const fail = (text: string) => setNotice({ ok: false, text });
  const uploaded = (patch: Partial<PresenterInitial>) => () => {
    set(patch);
    setNotice({ ok: true, text: "Uploaded." });
    if (inSetup && patch.photos) onSaved?.();
  };
  const save = () =>
    start(async () => {
      const r = await savePresenter(v);
      setNotice(r.ok ? { ok: true, text: inSetup && v.mode === "ai" && !v.photos ? "Saved. Now add their photo below." : "Saved." } : { ok: false, text: r.error ?? "Couldn't save." });
      if (r.ok && !(inSetup && v.mode === "ai" && !v.photos)) onSaved?.();
    });
  const make = () =>
    start(async () => {
      const r = await makePresenterVideo();
      setNotice(r.ok ? { ok: true, text: r.message ?? "Started." } : { ok: false, text: r.error ?? "Couldn't start." });
    });
  const write = () =>
    start(async () => {
      const r = await getFilmScript();
      if (r.ok) setScript(r.script ?? null);
      else fail(r.error ?? "Couldn't write a script.");
    });

  return (
    <div className={inSetup ? "space-y-5" : "max-w-2xl space-y-5"}>
      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map((m) => (
          <button key={m.key} type="button" onClick={() => set({ mode: m.key })} className={`rounded-xl border p-4 text-left ${v.mode === m.key ? "border-brand" : "border-line"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-fg">
              {m.title}
              {m.recommended && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">Recommended</span>}
            </span>
            <span className="mt-1 block text-[13px] text-fg-muted">{m.body}</span>
          </button>
        ))}
      </div>

      {v.mode !== "none" && (
        <Panel className="space-y-4 p-5">
          <p className="text-sm font-semibold text-fg">Who&apos;s on camera</p>
          <p className="-mt-3 text-[12px] text-fg-muted">The owner usually works best. It can be anyone on your team who agrees to it.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-fg">
              Their first name
              <input value={v.onCameraName} onChange={(e) => set({ onCameraName: e.target.value })} maxLength={40} placeholder="Gil" className={field} />
            </label>
            <label className="block text-sm text-fg">
              Their role
              <input value={v.onCameraRole} onChange={(e) => set({ onCameraRole: e.target.value })} maxLength={40} list="presenter-roles" className={field} />
              <datalist id="presenter-roles">
                {ROLES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            <label className="block text-sm text-fg">
              How to say it <span className="text-fg-muted">(optional)</span>
              <input value={v.onCameraPronunciation} onChange={(e) => set({ onCameraPronunciation: e.target.value })} maxLength={60} placeholder="e.g. eye-ZAY-un" className={field} />
            </label>
          </div>
          <p className="-mt-2 text-[12px] text-fg-muted">Spell the name the way it sounds if the AI voice might get it wrong. Captions still show it spelled as above.</p>
          {v.mode === "ai" && <p className="text-[13px] text-fg-muted">Their voice is picked under Ad Creative AI Context: one of ElevenLabs&apos; voices, or their own.</p>}
          <p className="text-[12px] text-fg-muted">Migz introduces them once, like &quot;I&apos;m {v.onCameraName.trim() || "Gil"}, {(v.onCameraRole.trim() || "owner").toLowerCase()} here at your company&quot;.</p>
        </Panel>
      )}

      <Panel className="space-y-4 p-5">
        <label className="block text-sm text-fg">
          Towns to name, separated by commas (up to 3)
          <input value={v.towns} onChange={(e) => set({ towns: e.target.value })} className={field} />
        </label>
        {v.mode === "ai" && (
          <div className="rounded-lg border border-line p-3">
            <label className="flex items-start gap-2 text-sm text-fg">
              <input type="checkbox" checked={v.consented} onChange={(e) => set({ consented: e.target.checked })} className="mt-0.5" />
              <span>The person on camera is me, or they agreed in writing to their photo and voice being used. I allow them to be used to generate ads for my business.</span>
            </label>
            <label className="mt-2 block text-sm text-fg">
              Your full name (the person agreeing)
              <input value={v.consentName} onChange={(e) => set({ consentName: e.target.value })} className={field} />
            </label>
          </div>
        )}
        <button type="button" onClick={save} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
          Save
        </button>
      </Panel>

      {(v.mode === "ai" || (v.mode === "film" && !inSetup)) && (
        <Panel className="space-y-4 p-5">
          {v.mode === "ai" && (
            <>
              {v.look.status && (
                <div className="flex items-center gap-4 rounded-lg bg-white/[0.04] p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- HeyGen's preview link, not an optimizable asset */}
                  {v.look.preview ? <img src={v.look.preview} alt="" crossOrigin="anonymous" className="h-28 w-16 rounded object-cover" /> : <div className="h-28 w-16 animate-pulse rounded bg-white/10" />}
                  <p className="text-[13px] text-fg-muted">
                    {v.look.status === "completed"
                      ? "Your jobsite look: this is how you'll appear in your videos, at a roofing job. Upload a new photo to make a new one."
                      : v.look.status === "failed"
                        ? "We couldn't make a jobsite look from that photo. Try a clearer, well-lit photo of your face."
                        : "Making your jobsite look from your photo. It takes a few minutes."}
                  </p>
                </div>
              )}
              <Upload label="A clear, well-lit photo of their face (even a selfie works: Migz puts them at a jobsite)" accept="image/jpeg,image/png,image/webp" kind="photo" have={v.photos ? "Added (the newest one is used)" : ""} onDone={uploaded({ photos: Math.min(3, v.photos + 1) })} onError={fail} />
              <p className="text-[13px] text-fg-muted">Their voice, job photos and clips are under Ad Creative AI Context.</p>
            </>
          )}
          {v.mode === "film" && !inSetup && (
            <>
              <button type="button" onClick={write} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
                Write my script
              </button>
              {script && <p className="whitespace-pre-line rounded-lg bg-white/[0.04] p-3 text-sm text-fg">{script}</p>}
              <Upload label="Your recording, held vertically" accept="video/mp4,video/quicktime,video/webm" kind="film" have={v.film ? "Added" : ""} onDone={uploaded({ film: true })} onError={fail} />
            </>
          )}
          {!inSetup && (
            <button type="button" onClick={make} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
              Make my video
            </button>
          )}
        </Panel>
      )}
      {notice && (
        <p role="status" className={`text-sm ${notice.ok ? "text-fg-muted" : "text-red-400"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
