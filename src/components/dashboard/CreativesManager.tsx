"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Film, ImageIcon, Trash2, UploadCloud } from "lucide-react";
import { confirmCreativeUpload, createCreativeUpload, deleteCreative } from "@/app/dashboard/actions";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";
import { fileSize } from "@/lib/dashboard/format";
import { Badge, Button, Panel, PanelHeader } from "@/components/dashboard/ui";
import { MigzMark } from "@/components/dashboard/Migz";
import { cn } from "@/lib/utils";

export type Creative = {
  id: string;
  kind: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  review_note: string | null;
  created_at: string;
  url: string | null;
};

type Upload = { id: string; name: string; progress: number; error?: string };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "bad" }> = {
  submitted: { label: "Submitted", tone: "neutral" },
  in_review: { label: "In review", tone: "accent" },
  live: { label: "Live in ads", tone: "good" },
  rejected: { label: "Not used", tone: "bad" },
};

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";

const TIPS = [
  "Vertical (9:16) video, 15–30 seconds",
  "Hook in the first 3 seconds: a question or a surprising fact",
  "Your face and voice build trust faster than stock footage",
  "Add captions; most people watch with the sound off",
  "No guarantees of approval, rates or savings",
];

function CreativeCard({ creative, onDelete }: { creative: Creative; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const status = STATUS[creative.status] ?? STATUS.submitted;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="group overflow-hidden rounded-xl border border-line bg-ink-raised"
    >
      <div className="relative aspect-[4/5] bg-ink-high">
        {creative.url && creative.kind === "video" ? (
          <video
            src={creative.url}
            crossOrigin="anonymous"
            muted
            playsInline
            loop
            preload="metadata"
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
            controls
            className="size-full object-cover"
          />
        ) : creative.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creative.url} alt="" crossOrigin="anonymous" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-fg-faint">Preview unavailable</div>
        )}
        <div className="pointer-events-none absolute left-2 top-2">
          <Badge tone={status.tone} className="bg-black/60 backdrop-blur">{status.label}</Badge>
        </div>
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {creative.kind === "video" ? (
          <Film className="mt-0.5 size-3.5 shrink-0 text-fg-faint" />
        ) : (
          <ImageIcon className="mt-0.5 size-3.5 shrink-0 text-fg-faint" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px]">{creative.file_name}</p>
          <p className="text-[11px] text-fg-faint">{fileSize(creative.size_bytes)}</p>
          {creative.review_note && <p className="mt-1 text-[12px] text-fg-muted">{creative.review_note}</p>}
        </div>
        {confirming ? (
          <div className="flex shrink-0 gap-1">
            <button onClick={() => setConfirming(false)} className="rounded px-1.5 text-[12px] text-fg-muted hover:text-fg">
              Keep
            </button>
            <button onClick={onDelete} className="rounded px-1.5 text-[12px] text-bad hover:underline">
              Delete
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${creative.file_name}`}
            className="rounded-md p-1 text-fg-faint opacity-0 transition hover:bg-white/[0.06] hover:text-bad focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </motion.li>
  );
}

export function CreativesManager({ creatives }: { creatives: Creative[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [, startTransition] = useTransition();

  const patch = (id: string, p: Partial<Upload>) =>
    setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function uploadOne(file: File) {
    const id = crypto.randomUUID();
    setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
    try {
      const start = await createCreativeUpload({ name: file.name, type: file.type, size: file.size });
      if (!start.ok) throw new Error(start.error);
      await uploadToSignedUrl(start.signedUrl, file, (f) => patch(id, { progress: f }));
      const done = await confirmCreativeUpload({ path: start.path, name: file.name, type: file.type, size: file.size });
      if (!done.ok) throw new Error(done.error);
      setUploads((u) => u.filter((x) => x.id !== id));
      startTransition(() => router.refresh());
    } catch (e) {
      patch(id, { error: e instanceof Error ? e.message : "Upload failed." });
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 10).forEach(uploadOne);
  };

  const remove = (id: string) =>
    startTransition(async () => {
      await deleteCreative(id);
      router.refresh();
    });

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div className="flex gap-3 rounded-xl border border-brand/25 bg-brand/[0.06] px-4 py-3.5">
          <MigzMark size="sm" active={false} />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-fg">The better your videos, the higher your returns.</p>
            <p className="text-fg-muted">
              Migz AI tests every creative you upload and puts more of your budget behind the ones that get calls
              booked. Real, well-lit videos of you usually beat everything else.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-brand bg-brand/5" : "border-line-strong hover:border-fg-faint hover:bg-white/[0.02]",
          )}
        >
          <motion.div animate={{ y: dragging ? -4 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
            <UploadCloud className={cn("size-7", dragging ? "text-brand" : "text-fg-faint")} />
          </motion.div>
          <p className="mt-3 text-sm font-medium">{dragging ? "Drop to upload" : "Drag photos or videos here"}</p>
          <p className="mt-1 text-[13px] text-fg-muted">or click to choose files · JPG, PNG, WebP, MP4, MOV</p>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <AnimatePresence initial={false}>
          {uploads.map((u) => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-lg border border-line bg-ink-raised px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="truncate">{u.name}</span>
                  {u.error ? (
                    <button
                      onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}
                      className="shrink-0 text-fg-muted hover:text-fg"
                    >
                      Dismiss
                    </button>
                  ) : (
                    <span className="shrink-0 tabular-nums text-fg-muted">{Math.round(u.progress * 100)}%</span>
                  )}
                </div>
                {u.error ? (
                  <p className="mt-1 text-[12px] text-bad">{u.error}</p>
                ) : (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <motion.div
                      className="h-full rounded-full bg-brand"
                      animate={{ width: `${Math.max(3, u.progress * 100)}%` }}
                      transition={{ ease: "linear", duration: 0.2 }}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {creatives.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence initial={false}>
              {creatives.map((c) => (
                <CreativeCard key={c.id} creative={c} onDelete={() => remove(c.id)} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          !uploads.length && (
            <Panel>
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <MigzMark active={false} />
                <p className="mt-4 text-sm font-medium text-fg">No creatives yet? Migz has you covered.</p>
                <p className="mt-1 max-w-sm text-[13px] text-fg-muted">
                  If you don&apos;t upload any, Migz AI generates ad creatives for you automatically so your ads can
                  still run. Add your own photos and videos anytime; they usually perform better.
                </p>
                <Button size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
                  Upload your own
                </Button>
              </div>
            </Panel>
          )
        )}
      </div>

      <Panel className="h-fit">
        <PanelHeader title="Help Migz get you better results" description="What works on Meta" />
        <ul className="space-y-2.5 px-5 py-4">
          {TIPS.map((t) => (
            <li key={t} className="flex gap-2.5 text-[13px] text-fg-muted">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand" />
              {t}
            </li>
          ))}
        </ul>
        <div className="border-t border-line px-5 py-3">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={() => inputRef.current?.click()}>
            Upload files
          </Button>
        </div>
      </Panel>
    </div>
  );
}
