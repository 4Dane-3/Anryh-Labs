"use client";

import { useState } from "react";
import { createCreativeUpload } from "@/app/dashboard/actions";
import { addJobMedia, removeJobMedia } from "@/app/dashboard/creatives/actions";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";
import { MAX_JOB_MEDIA, MEDIA_KINDS, type JobMedia, type MediaKind } from "@/lib/roofing/job-media";

export type MediaItem = JobMedia & { url: string | null };

const LABEL: Record<string, string> = Object.fromEntries([...MEDIA_KINDS.map((k) => [k.key, k.label]), ["other", "Job photo"]]);

/** Their real job photos and clips, sorted by what they show, so each video cuts to the one that fits the words. */
export function JobMediaSetup({ initial, onSaved }: { initial: MediaItem[]; onSaved?: () => void }) {
  const [items, setItems] = useState<MediaItem[]>(initial);
  const [kind, setKind] = useState<MediaKind>("crew");
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (files: File[]) => {
    setNotice(null);
    let added = 0;
    for (const [i, file] of files.entries()) {
      const type: JobMedia["type"] | null = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "photo" : null;
      if (!type) {
        setNotice({ ok: false, text: `${file.name}: use a photo or a video.` });
        continue;
      }
      try {
        setProgress(`${i + 1} of ${files.length}`);
        const started = await createCreativeUpload({ name: file.name, type: file.type, size: file.size });
        if (!started.ok) throw new Error(started.error);
        await uploadToSignedUrl(started.signedUrl, file, (p) => setProgress(`${i + 1} of ${files.length}: ${Math.round(p * 100)}%`));
        const saved = await addJobMedia(kind, started.path, type);
        if (!saved.ok) throw new Error(saved.error);
        setItems((xs) => [...xs, { path: started.path, kind, type, url: URL.createObjectURL(file) }].slice(-MAX_JOB_MEDIA));
        added++;
      } catch (e) {
        setNotice({ ok: false, text: `${file.name}: ${e instanceof Error ? e.message : "upload failed."}` });
      }
    }
    setProgress(null);
    if (added) {
      setNotice((n) => n ?? { ok: true, text: `Added ${added}.` });
      onSaved?.();
    }
  };

  const remove = async (path: string) => {
    const r = await removeJobMedia(path);
    if (r.ok) setItems((xs) => xs.filter((m) => m.path !== path));
    else setNotice({ ok: false, text: r.error ?? "Couldn't remove it." });
  };

  const count = (k: string) => items.filter((m) => m.kind === k).length;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-fg-muted">
        Real footage beats anything AI makes. Phone photos and short clips are perfect: vertical if you can, a few seconds each. Videos cut in as they are; photos get a slow camera move. Each video cuts to the one that matches what&apos;s being said.
      </p>
      <div>
        <p className="text-sm text-fg">What are you adding?</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {MEDIA_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)} className={`rounded-lg border px-3 py-2 text-left ${kind === k.key ? "border-brand" : "border-line"}`}>
              <span className="flex items-center justify-between text-[13px] font-semibold text-fg">
                {k.label}
                {count(k.key) > 0 && <span className="text-[11px] font-normal text-fg-muted">{count(k.key)} added</span>}
              </span>
              <span className="block text-[12px] text-fg-muted">{k.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="block text-sm text-fg">
        Add {LABEL[kind].toLowerCase()} <span className="text-fg-muted">{progress ?? `(${items.length} of ${MAX_JOB_MEDIA})`}</span>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          disabled={!!progress}
          className="mt-1 block text-sm text-fg-muted"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void send(files);
          }}
        />
      </label>
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((m) => (
            <figure key={m.path} className="relative overflow-hidden rounded-lg border border-line bg-white/[0.04]">
              {m.url && m.type === "video" ? (
                <video src={`${m.url}#t=0.5`} crossOrigin="anonymous" muted playsInline preload="metadata" className="aspect-[9/16] w-full object-cover" />
              ) : m.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not an optimizable asset
                <img src={m.url} alt="" crossOrigin="anonymous" className="aspect-[9/16] w-full object-cover" />
              ) : (
                <div className="aspect-[9/16] w-full" />
              )}
              <figcaption className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-[10px] leading-tight text-white">
                {LABEL[m.kind]}
                {m.type === "video" ? " · clip" : ""}
              </figcaption>
              <button type="button" onClick={() => remove(m.path)} aria-label="Remove" className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[12px] text-white">
                ×
              </button>
            </figure>
          ))}
        </div>
      )}
      {notice && (
        <p role="status" className={`text-sm ${notice.ok ? "text-fg-muted" : "text-red-400"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
