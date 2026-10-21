"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { usd } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

type Format = "usd" | "number";

function render(value: number, format: Format) {
  return format === "usd" ? usd(Math.round(value)) : Math.round(value).toLocaleString();
}

/** Counts up from zero once on mount; formatting stays in text tokens, never the accent. */
function AnimatedNumber({ value, format }: { value: number; format: Format }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = render(value, format);
      return;
    }
    const controls = animate(0, value, {
      duration: 0.7,
      ease: [0.25, 0.8, 0.25, 1],
      onUpdate: (v) => (el.textContent = render(v, format)),
    });
    return () => controls.stop();
  }, [value, format, reduce]);

  return <span ref={ref}>{render(value, format)}</span>;
}

export function StatTile({
  label,
  value,
  format = "number",
  hint,
  emphasis,
  index = 0,
}: {
  label: string;
  value: number | null;
  format?: Format;
  hint?: React.ReactNode;
  emphasis?: boolean;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: "easeOut" }}
      className={cn(
        "rounded-xl border border-line bg-ink-raised p-5",
        emphasis && "border-brand/25",
      )}
    >
      <p className="text-[13px] text-fg-muted">{label}</p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-fg">
        {value === null ? <span className="text-fg-faint">—</span> : <AnimatedNumber value={value} format={format} />}
      </p>
      {hint && <p className="mt-2 text-xs text-fg-faint">{hint}</p>}
    </motion.div>
  );
}
