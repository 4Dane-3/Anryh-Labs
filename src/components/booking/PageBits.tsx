"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { track } from "@/lib/booking/track";

/**
 * Phones only: a "Book a free consultation" bar pinned to the bottom once the booking card has scrolled out of
 * view (after the visitor has read past it), so booking is always one tap away.
 */
export function StickyBookBar({ preview }: { preview: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const card = document.getElementById("book");
    if (!card) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(card);
    return () => io.disconnect();
  }, []);
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur transition-transform duration-300 lg:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!show}
    >
      <button
        type="button"
        tabIndex={show ? 0 : -1}
        onClick={() => {
          if (!preview) track("sticky_click");
          document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 text-base font-semibold text-white active:bg-blue-800"
      >
        <CalendarDays className="size-5" /> Book a free consultation
      </button>
    </div>
  );
}

/** The agent's bio, folded after a few lines on phones so it never pushes booking down. */
export function AboutAgent({ firstName, bio, preview }: { firstName: string; bio: string; preview: boolean }) {
  const [open, setOpen] = useState(false);
  const long = bio.length > 260;
  return (
    <div>
      <h2 className="text-lg font-semibold">About {firstName}</h2>
      <p className={`mt-2 whitespace-pre-line leading-relaxed text-slate-600 ${long && !open ? "line-clamp-4 lg:line-clamp-none" : ""}`}>{bio}</p>
      {long && !open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (!preview) track("bio_expand");
          }}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-blue-700 lg:hidden"
        >
          Read more <ChevronDown className="size-4" />
        </button>
      )}
    </div>
  );
}
