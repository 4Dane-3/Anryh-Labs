"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSpecial, replaceSpecial } from "@/app/dashboard/special/actions";
import { Button, Panel, Switch } from "@/components/dashboard/ui";
import { SPECIALS } from "@/lib/roofing/setup-options";
import { cn } from "@/lib/utils";

/** Confirm the special, or replace it (and the ads promoting it). `answer` comes from the email's buttons. */
export function SpecialCheck({ special, confirmedAt, liveAds, answer }: { special: string | null; confirmedAt: string | null; liveAds: number; answer: "yes" | "ended" | null }) {
  const router = useRouter();
  const [ended, setEnded] = useState(answer === "ended" || !special);
  const [next, setNext] = useState("");
  const [replaceAds, setReplaceAds] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const confirmedOnce = useRef(false);

  const confirm = () =>
    start(async () => {
      const r = await confirmSpecial();
      setNotice(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });
  // The email's "Yes, still running" button confirms on arrival
  useEffect(() => {
    if (answer === "yes" && special && !confirmedOnce.current) {
      confirmedOnce.current = true;
      confirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replace = () =>
    start(async () => {
      const r = await replaceSpecial({ newSpecial: next, replaceAds });
      setNotice(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setNext("");
        setEnded(false);
      }
      router.refresh();
    });

  return (
    <div className="max-w-2xl space-y-4">
      <Panel className="space-y-4 p-5">
        {special ? (
          <>
            <div>
              <p className="text-[12px] uppercase tracking-wide text-fg-faint">Featured in your ads</p>
              <p className="mt-1 text-lg font-semibold text-fg">{special}</p>
              <p className="text-[13px] text-fg-muted">
                {liveAds} live ad{liveAds === 1 ? "" : "s"} mention it.
                {confirmedAt ? ` Last confirmed ${new Date(confirmedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` : ""}
              </p>
            </div>
            {!ended && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={confirm} disabled={pending}>Yes, still running</Button>
                <button type="button" onClick={() => setEnded(true)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg hover:border-line-strong">
                  It&apos;s ended
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-[13px] text-fg-muted">Your ads don&apos;t feature a special right now. Add one below.</p>
        )}

        {ended && (
          <div className="space-y-3 border-t border-line pt-4">
            <p className="text-sm font-medium text-fg">{special ? "What's the new special?" : "Your special"}</p>
            <div className="flex flex-wrap gap-2">
              {SPECIALS.map((s) => (
                <button key={s} type="button" aria-pressed={next === s} onClick={() => setNext(s)} className={cn("rounded-full border px-3 py-1 text-[12px]", next === s ? "border-brand bg-brand/10 text-fg" : "border-line text-fg-muted hover:text-fg")}>
                  {s}
                </button>
              ))}
            </div>
            <input value={next} onChange={(e) => setNext(e.target.value)} maxLength={60} placeholder="Or type it exactly as you offer it" className="w-full rounded-lg border border-line bg-ink-high px-3 py-2 text-sm text-fg" />
            {special && (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-fg">Take down the ads promoting the old special</p>
                  <p className="text-[13px] text-fg-muted">Migz pauses them and makes new ones with the new special.</p>
                </div>
                <Switch checked={replaceAds} label="Take down the old ads" onChange={setReplaceAds} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={replace} disabled={pending || (!special && !next.trim())}>{next.trim() ? "Use this special" : "Run with no special"}</Button>
              {special && (
                <button type="button" onClick={() => setEnded(false)} className="text-[13px] text-fg-muted hover:text-fg">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
        {notice && <p role="status" className={cn("text-[13px]", notice.ok ? "text-good" : "text-bad")}>{notice.text}</p>}
      </Panel>
    </div>
  );
}
