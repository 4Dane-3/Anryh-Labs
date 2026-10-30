"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { setIntentLevel, setVideoTier } from "@/app/dashboard/actions";
import { Button, Panel, PanelHeader } from "@/components/dashboard/ui";
import { INTENT_LEVELS, MIN_SPLIT_DAILY_CENTS, VIDEO_TIERS, videoChargeLine, type IntentLevel, type VideoTier } from "@/lib/ad-options";
import { cn } from "@/lib/utils";

// Lead style and video quality: the pickers the batch planner uses, and the Settings panels around them.

const INTENT_ORDER: IntentLevel[] = ["medium_high", "low_medium"];
const TIER_ORDER: VideoTier[] = ["standard", "seedance_15", "seedance_30"];
const price = (cents: number) => (cents ? `$${(cents / 100).toFixed(0)} per video` : "Included");

function Choice({ selected, onClick, disabled, title, badge, children, dot }: { selected: boolean; onClick: () => void; disabled?: boolean; title: string; badge?: string; children: React.ReactNode; dot: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
        selected ? "border-brand/60 bg-brand/[0.08]" : "border-line hover:border-line-strong hover:bg-white/[0.03]",
      )}
    >
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-brand" : "border-line-strong")}>
        {selected && <motion.span layoutId={dot} className="size-2 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">{title}</span>
          {badge && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-fg-muted">{badge}</span>}
        </span>
        <span className="mt-1 block text-[12px] leading-snug text-fg-muted">{children}</span>
      </span>
    </button>
  );
}

export function IntentPicker({ value, onChange, disabled, idPrefix = "intent" }: { value: IntentLevel; onChange: (v: IntentLevel) => void; disabled?: boolean; idPrefix?: string }) {
  return (
    <div role="radiogroup" aria-label="What kind of leads" className="grid gap-2 sm:grid-cols-2">
      {INTENT_ORDER.map((k) => (
        <Choice key={k} selected={value === k} onClick={() => onChange(k)} disabled={disabled} title={INTENT_LEVELS[k].title} dot={`${idPrefix}-dot`}>
          {INTENT_LEVELS[k].detail}
        </Choice>
      ))}
    </div>
  );
}

export function VideoTierPicker({ value, onChange, disabled, idPrefix = "video" }: { value: VideoTier; onChange: (v: VideoTier) => void; disabled?: boolean; idPrefix?: string }) {
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Video quality" className="grid gap-2 sm:grid-cols-3">
        {TIER_ORDER.map((k) => (
          <Choice key={k} selected={value === k} onClick={() => onChange(k)} disabled={disabled} title={VIDEO_TIERS[k].title} badge={price(VIDEO_TIERS[k].priceCents)} dot={`${idPrefix}-dot`}>
            {VIDEO_TIERS[k].detail}
          </Choice>
        ))}
      </div>
      <p className={cn("text-[12px] leading-snug", VIDEO_TIERS[value].priceCents ? "text-brand" : "text-fg-faint")}>{videoChargeLine(value)}</p>
    </div>
  );
}

/** Settings: lead style. Saves on click and builds (or retires) the instant-form ad set right away. */
export function IntentLevelForm({ level, blocked }: { level: IntentLevel; blocked: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(level);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choose = (next: IntentLevel) =>
    startTransition(async () => {
      const previous = value;
      setValue(next);
      setError(null);
      const res = await setIntentLevel(next);
      if (!res.ok) {
        setValue(previous);
        setError(res.error);
      }
      router.refresh();
    });
  return (
    <Panel>
      <PanelHeader title="Lead style" description="More, cheaper leads, or fewer, more serious booked calls. You can switch any time; Migz changes your campaign right away." />
      <div className="space-y-3 px-5 py-5">
        <IntentPicker value={value} onChange={choose} disabled={pending} idPrefix="settings-intent" />
        {value === "low_medium" && (
          <p className="text-[12px] leading-snug text-fg-faint">
            Form leads show under Clients and ping your Slack. Instant forms need about ${MIN_SPLIT_DAILY_CENTS / 100}/day or more in a batch, so the budget can run both.
          </p>
        )}
        {value === "low_medium" && blocked && <p className="text-[13px] text-bad">Instant forms are on hold: {blocked}. Your ads keep sending people to your booking page meanwhile.</p>}
        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
    </Panel>
  );
}

/** Settings: video quality. A paid tier needs an explicit "yes" to its per-video price before it's saved. */
export function VideoTierForm({ tier }: { tier: VideoTier }) {
  const router = useRouter();
  const [saved, setSaved] = useState(tier);
  const [value, setValue] = useState(tier);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (next: VideoTier) =>
    startTransition(async () => {
      setError(null);
      const res = await setVideoTier(next);
      if (!res.ok) return setError(res.error);
      setSaved(next);
      router.refresh();
    });
  const paid = VIDEO_TIERS[value].priceCents > 0;
  return (
    <Panel>
      <PanelHeader title="Video quality" description="The model Migz makes your video ads with. Images are always included." />
      <div className="space-y-3 px-5 py-5">
        <VideoTierPicker
          value={value}
          disabled={pending}
          idPrefix="settings-video"
          onChange={(next) => {
            setValue(next);
            // Going back to Standard costs nothing, so it saves straight away; a paid tier waits for the yes
            if (!VIDEO_TIERS[next].priceCents && next !== saved) save(next);
          }}
        />
        {paid && value !== saved && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => save(value)} disabled={pending}>
              Use {VIDEO_TIERS[value].title} · ${(VIDEO_TIERS[value].priceCents / 100).toFixed(0)} per video
            </Button>
            <button type="button" className="text-[13px] text-fg-muted hover:text-fg" onClick={() => setValue(saved)}>
              Cancel
            </button>
          </div>
        )}
        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
    </Panel>
  );
}
