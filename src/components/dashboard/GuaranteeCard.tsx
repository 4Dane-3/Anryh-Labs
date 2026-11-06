import { CircleAlert, CircleCheck, ShieldCheck } from "lucide-react";
import type { Condition } from "@/lib/guarantee";
import { usd } from "@/lib/dashboard/format";
import { Panel, PanelHeader } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

// The booked-call guarantee on the Ad funds page: the day, booked calls against the target, the conditions, and
// what happens at the end. Read-only; the hourly run settles it and staff approve a refund.

export type GuaranteeView = {
  status: "running" | "met" | "missed" | "ineligible" | "refunded" | "declined";
  day: number;
  daysTotal: number;
  endsOn: string;
  target: number;
  bookings: number;
  feeCents: number;
  conditions: Condition[];
  onTrack: boolean;
};

const HEADLINE: Record<GuaranteeView["status"], string> = {
  running: "",
  met: "Guarantee met",
  missed: "Under target: your fee refund is being reviewed",
  ineligible: "Ended without qualifying",
  refunded: "Your Anryh Labs fee was credited back",
  declined: "Refund not approved",
};

export function GuaranteeCard({ g, roof }: { g: GuaranteeView; roof?: boolean }) {
  const unit = roof ? "booked inspections" : "booked calls";
  const pct = Math.min(100, (g.bookings / g.target) * 100);
  return (
    <Panel>
      <PanelHeader
        title={roof ? "Booked-inspection guarantee" : "Booked-call guarantee"}
        description={
          g.status === "running"
            ? `Day ${g.day} of ${g.daysTotal}. Get ${g.target} ${unit} in your first ${g.daysTotal} days, or we credit back your Anryh Labs fee, as long as the conditions below are met.`
            : HEADLINE[g.status]
        }
        action={<ShieldCheck className="size-5 text-brand" />}
      />
      <div className="space-y-4 px-5 py-4">
        <div>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-fg">
              <span className="text-2xl font-semibold tabular-nums">{g.bookings}</span> <span className="text-fg-muted">of {g.target} {unit}</span>
            </span>
            <span className="text-fg-faint">{g.status === "running" ? `ends ${g.endsOn}` : `ended ${g.endsOn}`}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
            <div className={cn("h-full rounded-full", g.bookings >= g.target ? "bg-good" : "bg-brand")} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <ul className="space-y-1.5">
          {g.conditions.map((c) => {
            // Funding can still be topped up while it's running: a warning, not a failure
            const warn = !c.ok && g.status === "running" && c.key === "funded";
            return (
              <li key={c.key} className="flex items-start gap-2 text-[13px]">
                {c.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" /> : <CircleAlert className={cn("mt-0.5 size-4 shrink-0", warn ? "text-brand" : "text-bad")} />}
                <span>
                  <span className="text-fg">{c.label}</span> <span className="text-fg-muted">· {c.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-[12px] leading-relaxed text-fg-faint">
          {g.status === "running"
            ? `Only ${unit} on your Anryh Labs page count; what happens ${roof ? "at the inspection" : "on the call"} is up to you. The refund is the Anryh Labs fee on the funds you add (${usd(g.feeCents, { cents: false })} so far), credited to your ad balance. Ad spend paid to Meta isn't refundable.`
            : g.status === "refunded"
              ? `${usd(g.feeCents, { cents: false })} was added to your ad balance.`
              : g.status === "ineligible"
                ? "A condition above wasn't met, so the guarantee didn't apply this time."
                : g.status === "missed"
                  ? `We're reviewing a refund of ${usd(g.feeCents, { cents: false })} to your ad balance.`
                  : null}
        </p>
      </div>
    </Panel>
  );
}
