import { DateTime } from "luxon";
import { Panel, PanelHeader } from "@/components/dashboard/ui";
import { phone } from "@/lib/dashboard/format";
import type { CallBack } from "@/lib/dashboard/queries";

/** Clients: quote requests and instant-form leads waiting for a call back. */
export function CallBacks({ rows, timezone }: { rows: CallBack[]; timezone: string }) {
  if (!rows.length) return null;
  return (
    <Panel className="mb-4">
      <PanelHeader
        title="Call backs"
        description="People who left their number without booking a time: quote requests from your page and leads from your instant forms. Call them soon; these go cold within hours."
      />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">
                {r.name}
                <span className="ml-2 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-normal text-fg-muted">{r.source === "instant_form" ? "Instant form" : "Quote request"}</span>
                {r.booked_at && <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-normal text-brand">Booked a call</span>}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-fg-muted">
                {[/^\+1\d{10}$/.test(r.phone) ? phone(r.phone) : r.phone, r.email, r.coverage, r.best_time && `best ${r.best_time.toLowerCase()}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[12px] text-fg-faint">{DateTime.fromISO(r.created_at).setZone(timezone).toFormat("LLL d, h:mm a")}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
