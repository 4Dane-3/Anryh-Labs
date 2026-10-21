"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  active,
  id,
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
  id: string; // unique per page so indicators on different pages don't animate between each other
}) {
  return (
    <div className="mb-6 inline-flex rounded-lg border border-line bg-ink-raised p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            "relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
            active === t.key ? "text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          {active === t.key && (
            <motion.span
              layoutId={`tabs-${id}`}
              className="absolute inset-0 rounded-md bg-white/[0.08]"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{t.label}</span>
        </Link>
      ))}
    </div>
  );
}
