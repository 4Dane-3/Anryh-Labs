import { cn } from "@/lib/utils";

export type Metric = { label: string; value: string | null; hint?: React.ReactNode };

/** The key numbers in one row under a thin rule, the first one lit: the Overview's bottom line. */
export function MetricRow({ items }: { items: Metric[] }) {
  return (
    <dl className="relative grid grid-cols-2 gap-x-6 gap-y-6 border-t border-white/25 pt-5 lg:grid-cols-4">
      <span className="absolute -top-px left-0 h-0.5 w-[calc(50%-12px)] bg-brand lg:w-[calc(25%-18px)]" aria-hidden="true" />
      {items.map((m, i) => (
        <div key={m.label} className="min-w-0">
          <dt className={cn("text-[13px]", i === 0 ? "text-fg" : "text-fg-muted")}>{m.label}</dt>
          <dd className="mt-1.5 text-3xl font-normal leading-none tracking-[-0.03em] text-fg sm:text-4xl">
            {m.value ?? <span className="text-fg-faint">—</span>}
          </dd>
          {m.hint && <dd className="mt-2 text-xs text-fg-faint">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
