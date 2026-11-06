"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoofingSettings, testCrmWebhook } from "@/app/dashboard/actions";
import { Button, Label, Panel, PanelHeader, inputClass } from "@/components/dashboard/ui";
import { STATE_CODES } from "@/lib/campaign-plan";
import { RADIUS_CHOICES } from "@/lib/verticals";
import { cn } from "@/lib/utils";

export type RoofingInitial = { service_area: string; state: string; radius: number; crews: number; license: string; crm_webhook_url: string };

/** Where a roofer's ads run and how bookings reach them: Start here's service area step and Settings. */
export function ServiceAreaFields({ value, onChange }: { value: RoofingInitial; onChange: (v: RoofingInitial) => void }) {
  const set = <K extends keyof RoofingInitial>(k: K, v: RoofingInitial[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_96px]">
        <div>
          <Label htmlFor="roof-area">Where your crews work from</Label>
          <input id="roof-area" className={inputClass} placeholder="Address, city or ZIP, e.g. Plano, TX 75023" value={value.service_area} onChange={(e) => set("service_area", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="roof-state">State</Label>
          <select id="roof-state" className={inputClass} value={value.state} onChange={(e) => set("state", e.target.value)}>
            <option value="">–</option>
            {STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] text-fg-muted">How far your ads reach (homeowners living within)</p>
        <div className="grid grid-cols-4 gap-2">
          {RADIUS_CHOICES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={value.radius === r}
              onClick={() => set("radius", r)}
              className={cn("h-10 rounded-xl border text-sm tabular-nums", value.radius === r ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
            >
              {r} mi
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] text-fg-muted">Inspections you can do at the same time</p>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={value.crews === c}
              onClick={() => set("crews", c)}
              className={cn("h-10 rounded-xl border text-sm", value.crews === c ? "border-brand/60 bg-brand/10 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}
            >
              {c === 1 ? "One at a time" : "Two at once (2 crews)"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor="roof-license">Contractor license # (optional)</Label>
        <input id="roof-license" className={inputClass} value={value.license} onChange={(e) => set("license", e.target.value)} />
      </div>
    </div>
  );
}

export function RoofingForm({ initial }: { initial: RoofingInitial }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await saveRoofingSettings(v);
      setMsg(res.ok ? { ok: true, text: "Saved. A new area or radius goes to your live ads now." } : { ok: false, text: res.error });
      router.refresh();
    });
  const test = () =>
    start(async () => {
      const res = await testCrmWebhook(v.crm_webhook_url);
      setMsg(res.ok ? { ok: true, text: "Sent a sample booking. Map its fields in Zapier, then save." } : { ok: false, text: res.error });
    });
  return (
    <Panel>
      <PanelHeader title="Service area & bookings" description="Where your ads run, how many inspections you take at once, and where each booking goes." />
      <div className="space-y-5 px-5 pb-5">
        <ServiceAreaFields value={v} onChange={setV} />
        <div>
          <Label htmlFor="roof-crm">CRM webhook (optional)</Label>
          <div className="flex gap-2">
            <input id="roof-crm" className={inputClass} placeholder="https://hooks.zapier.com/hooks/catch/…" value={v.crm_webhook_url} onChange={(e) => setV({ ...v, crm_webhook_url: e.target.value })} />
            <Button type="button" variant="secondary" onClick={test} disabled={pending || !v.crm_webhook_url}>
              Send a test
            </Button>
          </div>
          <details className="mt-2 text-[13px] text-fg-muted">
            <summary className="cursor-pointer text-fg">How to send bookings to JobNimbus, AccuLynx or Leap</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>In Zapier, make a Zap that starts with <b>Webhooks by Zapier → Catch Hook</b>. Copy its URL here and press Send a test.</li>
              <li>
                Add your CRM as the action: <b>JobNimbus → Create Contact</b> (and Create Task for the inspection time), <b>AccuLynx → Create Lead</b>, or{" "}
                <b>Leap → Create Customer/Job</b>.
              </li>
              <li>Map the fields: first_name, last_name, phone, email, address, starts_at_local, roof_issue, roof_age. Turn the Zap on.</li>
            </ol>
            <p className="mt-2">Each booking is sent once, the moment it&rsquo;s made. Nothing is read back from your CRM; what happens after the inspection is yours.</p>
          </details>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="primary" onClick={save} disabled={pending}>
            Save
          </Button>
          {msg && <p className={cn("text-[13px]", msg.ok ? "text-fg-muted" : "text-bad")}>{msg.text}</p>}
        </div>
      </div>
    </Panel>
  );
}
