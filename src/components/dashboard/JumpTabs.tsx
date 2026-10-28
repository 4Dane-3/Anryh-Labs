"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A sticky row of tabs that scroll the page to its sections (for long pages like the Migz brain). The
 * section in view is highlighted as the agent scrolls. Sections that aren't on the page are left out.
 * Each section needs a matching id and a scroll margin (scroll-mt-32 lg:scroll-mt-20) to land below the bar.
 */
export function JumpTabs({ sections }: { sections: { id: string; label: string }[] }) {
  const [present, setPresent] = useState(sections);
  const [active, setActive] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // A tapped tab stays lit until the agent scrolls by hand (sections side by side share a row, and the
  // last one may never reach the top)
  const picked = useRef(false);

  useEffect(() => {
    const found = sections.filter((s) => document.getElementById(s.id));
    const frame = requestAnimationFrame(() => setPresent(found));
    // The section crossing the upper part of the screen is the one being read
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit && !picked.current) setActive(hit.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    for (const s of found) observer.observe(document.getElementById(s.id)!);
    const byHand = () => (picked.current = false);
    const keys = (e: KeyboardEvent) => ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && byHand();
    window.addEventListener("wheel", byHand, { passive: true });
    window.addEventListener("touchmove", byHand, { passive: true });
    window.addEventListener("keydown", keys);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("wheel", byHand);
      window.removeEventListener("touchmove", byHand);
      window.removeEventListener("keydown", keys);
    };
  }, [sections]);

  // Keep the highlighted tab visible in the bar on phones, where the row scrolls sideways
  useEffect(() => {
    if (!active) return;
    bar.current?.querySelector<HTMLElement>(`[data-jump="${active}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  function jump(e: React.MouseEvent, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    picked.current = true;
    setActive(id);
  }

  if (present.length < 2) return null;
  return (
    <nav
      aria-label="Jump to a section"
      className="sticky top-[57px] z-20 -mx-4 mb-6 border-b border-line bg-ink/90 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0"
    >
      <div ref={bar} className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {present.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-jump={s.id}
            onClick={(e) => jump(e, s.id)}
            aria-current={active === s.id ? "true" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              active === s.id ? "bg-white/[0.08] text-fg" : "text-fg-muted hover:bg-white/[0.04] hover:text-fg",
            )}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
