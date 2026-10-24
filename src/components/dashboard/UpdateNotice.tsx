"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const CHECK_EVERY_MS = 90_000;

/**
 * A slim notice when Migz has been updated since this page loaded. A page left open across an update
 * can't save (its buttons point at the old server), so people are asked to refresh before they type, and
 * anything unsaved in the testimonial form is kept in this browser either way.
 */
export function UpdateNotice({ version }: { version: string }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (version === "dev") return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const { v } = (await res.json()) as { v?: string };
        if (v && v !== "dev" && v !== version) setStale(true);
      } catch {
        // offline for a moment: check again next time
      }
    };
    const id = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [version]);
  if (!stale) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-brand/30 bg-[#2a1d0f]/95 px-4 py-2 text-[13px] backdrop-blur sm:px-8">
      <p className="text-fg">
        <span className="font-semibold text-brand">Migz was just updated.</span>
        <span className="text-fg-muted"> Refresh to keep saving. Anything you&apos;ve typed is kept.</span>
      </p>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-[12px] font-semibold text-brand-fg hover:bg-brand/90">
        <RefreshCw className="size-3.5" /> Refresh
      </button>
    </div>
  );
}
