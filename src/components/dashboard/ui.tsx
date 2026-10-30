import { forwardRef } from "react";
import { cn } from "@/lib/utils";

// Small glass-theme primitives shared by every dashboard page.

export const inputClass =
  "w-full rounded-lg border border-line bg-ink-high px-3 py-2 text-sm text-fg placeholder:text-fg-faint transition-colors focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-50";

type ButtonProps = React.ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,color,border-color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-brand text-brand-fg hover:bg-brand/90",
        variant === "secondary" && "border border-line bg-ink-high text-fg hover:border-line-strong hover:bg-white/[0.06]",
        variant === "ghost" && "text-fg-muted hover:bg-white/[0.05] hover:text-fg",
        variant === "danger" && "text-bad hover:bg-bad/10",
        className,
      )}
      {...props}
    />
  );
});

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      // min-w-0 lets panels shrink inside grids (otherwise a measured chart width pins them wide)
      className={cn("min-w-0 rounded-2xl border border-line bg-ink-raised backdrop-blur-xl", className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl font-normal tracking-[-0.035em] text-fg sm:text-5xl">{title}</h1>
        {description && <p className="mt-1 max-w-xl text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-fg-muted", className)} {...props} />;
}

const badgeTones = {
  neutral: "bg-white/[0.06] text-fg-muted",
  accent: "bg-brand/15 text-brand",
  good: "bg-good/15 text-good",
  bad: "bg-bad/15 text-bad",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] text-fg-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand" : "bg-white/[0.12]",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Segmented tabs driven by links, with a sliding indicator. */
export { Tabs } from "@/components/dashboard/Tabs";

/** A banner for features that light up once an integration is connected. */
export function NotConnected({ service, children }: { service: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[13px] text-fg-muted">
      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-fg-faint" />
      <p>
        <span className="font-medium text-fg">{service} isn&apos;t connected yet.</span> {children}
      </p>
    </div>
  );
}
