import { cn } from "@/lib/utils";

// Migz AI: the agent that runs each agent's Meta ads. One mark and one status line, reused wherever
// the dashboard talks about who is managing the ads.

export function MigzMark({ size = "md", active = true }: { size?: "sm" | "md"; active?: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-lg bg-brand font-bold text-brand-fg",
        size === "sm" ? "size-6 text-[11px]" : "size-9 text-sm",
      )}
      aria-hidden="true"
    >
      M
      {active && (
        <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full border-2 border-ink-raised bg-good" />
        </span>
      )}
    </span>
  );
}

/** "Migz AI · Watching your ads" with a live dot, or a waiting state until Meta is connected. */
export function MigzStatus({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <MigzMark active={connected} />
      <div>
        <p className="text-sm font-semibold text-fg">Migz AI</p>
        <p className="text-[12px] text-fg-muted">
          {connected ? "Running your ads · checks results throughout the day" : "Ready to run your ads once your ad account is linked"}
        </p>
      </div>
    </div>
  );
}
