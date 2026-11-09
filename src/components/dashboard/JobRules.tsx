"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveJobRules } from "@/app/dashboard/actions";
import { Button, Label, Panel, Switch, inputClass } from "@/components/dashboard/ui";
import { FORM_DEFAULTS, JOB_TYPES, ROOF_TYPES, type ClaimRule, type JobRules, type PropertyRule } from "@/lib/roofing/job-rules";
import { cn } from "@/lib/utils";

// "Jobs we take": what a roofer accepts. Emma's calls and the booking page follow it; Settings and Start here share this form.

type Draft = { jobTypes: string[]; minJobDollars: string; claims: ClaimRule; minRoofAge: string; roofTypes: string[]; property: PropertyRule; homeownerOnly: boolean; allDecisionMakers: boolean; financing: boolean; emergencies: boolean; excluded: string; notes: string };

const toDraft = (r: JobRules): Draft => ({
  jobTypes: r.jobTypes, minJobDollars: r.minJobDollars ? String(r.minJobDollars) : "", claims: r.claims, minRoofAge: r.minRoofAge ? String(r.minRoofAge) : "", roofTypes: r.roofTypes,
  property: r.property, homeownerOnly: r.homeownerOnly, allDecisionMakers: r.allDecisionMakers, financing: r.financing, emergencies: r.emergencies, excluded: r.excluded.join(", "), notes: r.notes,
});

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors", on ? "border-brand bg-brand/15 text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg")}>
      {children}
    </button>
  );
}

function Row({ title, hint, on, onChange }: { title: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="text-[13px] text-fg-muted">{hint}</p>
      </div>
      <Switch checked={on} label={title} onChange={onChange} />
    </div>
  );
}

export function JobRulesForm({ initial, onSaved }: { initial: JobRules | null; onSaved?: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(toDraft(initial ?? FORM_DEFAULTS));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggle = (k: "jobTypes" | "roofTypes", id: string) => set(k, d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id]);

  const save = (clear = false) =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const res = await saveJobRules(clear ? null : d);
      if (!res.ok) return setError(res.error);
      if (clear) setD(toDraft(FORM_DEFAULTS));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
      onSaved?.();
    });

  return (
    <div className="space-y-5">
      {!initial && <p className="rounded-lg bg-white/[0.04] px-4 py-3 text-[13px] text-fg-muted">Nothing saved yet, so every lead gets through. Choose what you want and save: your AI assistant and your booking page will then follow it.</p>}

      <div>
        <Label>Jobs you take</Label>
        <div className="flex flex-wrap gap-2">
          {JOB_TYPES.map((t) => (
            <Chip key={t.id} on={d.jobTypes.includes(t.id)} onClick={() => toggle("jobTypes", t.id)}>{t.label}</Chip>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-fg-muted">Pick none to take every kind.</p>
      </div>

      <div>
        <Label>Roof types you work on</Label>
        <div className="flex flex-wrap gap-2">
          {ROOF_TYPES.map((t) => (
            <Chip key={t.id} on={d.roofTypes.includes(t.id)} onClick={() => toggle("roofTypes", t.id)}>{t.label}</Chip>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-fg-muted">Pick none to take every type.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Insurance-claim jobs</Label>
          <div className="flex flex-wrap gap-2">
            {([["any", "Either"], ["only", "Claims only"], ["never", "No claims"]] as const).map(([v, label]) => (
              <Chip key={v} on={d.claims === v} onClick={() => set("claims", v)}>{label}</Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>Homes or businesses</Label>
          <div className="flex flex-wrap gap-2">
            {([["both", "Both"], ["residential", "Residential"], ["commercial", "Commercial"]] as const).map(([v, label]) => (
              <Chip key={v} on={d.property === v} onClick={() => set("property", v)}>{label}</Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <Label htmlFor="jr-age">Replacements: roof at least (years)</Label>
          <input id="jr-age" inputMode="numeric" className={`${inputClass} w-32`} placeholder="Any age" value={d.minRoofAge} onChange={(e) => set("minRoofAge", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="jr-min">Smallest job ($)</Label>
          <input id="jr-min" inputMode="numeric" className={`${inputClass} w-32`} placeholder="No minimum" value={d.minJobDollars} onChange={(e) => set("minJobDollars", e.target.value)} />
        </div>
      </div>

      <div className="space-y-4">
        <Row title="Homeowners only" hint="Renters are politely turned away." on={d.homeownerOnly} onChange={(v) => set("homeownerOnly", v)} />
        <Row title="Everyone who decides must be at the inspection" hint="Asked, and flagged to you if not. It never turns anyone away." on={d.allDecisionMakers} onChange={(v) => set("allDecisionMakers", v)} />
        <Row title="You offer financing" hint="Your assistant mentions it only if they ask about cost or payment." on={d.financing} onChange={(v) => set("financing", v)} />
        <Row title="You take same-day emergencies (active leaks)" hint="On: the earliest slot is offered and you're alerted right away. Off: they're booked for your next normal inspection, never promised same-day." on={d.emergencies} onChange={(v) => set("emergencies", v)} />
      </div>

      <div>
        <Label htmlFor="jr-ex">ZIP codes or towns you won&apos;t go to</Label>
        <textarea id="jr-ex" rows={2} className={inputClass} placeholder="75001, Frisco" value={d.excluded} onChange={(e) => set("excluded", e.target.value)} />
        <p className="mt-1 text-[12px] text-fg-muted">Inside your service radius. Separate with commas.</p>
      </div>
      <div>
        <Label htmlFor="jr-notes">Anything else</Label>
        <textarea id="jr-notes" rows={2} className={inputClass} placeholder="e.g. No roofs over three stories" value={d.notes} onChange={(e) => set("notes", e.target.value)} />
        <p className="mt-1 text-[12px] text-fg-muted">Shown to you with each lead. It doesn&apos;t turn anyone away by itself.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save()} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {initial && (
          <button type="button" className="text-[13px] text-fg-muted hover:text-fg" disabled={pending} onClick={() => save(true)}>Take every lead again</button>
        )}
        {saved && <span className="text-[13px] text-good">Saved</span>}
        {error && <span className="text-[13px] text-bad">{error}</span>}
      </div>
    </div>
  );
}

/** Settings: the same form in a panel. */
export function JobRulesPanel({ initial }: { initial: JobRules | null }) {
  return (
    <Panel>
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-fg">Jobs you take</h2>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Tell your AI assistant and your booking page what work you want. Homeowners who don&apos;t fit are politely told you&apos;re not the right fit and aren&apos;t booked; when an answer is missing or &quot;not sure&quot;, they can still book and you&apos;re told what to check.
        </p>
      </div>
      <div className="border-t border-line px-5 py-4">
        <JobRulesForm initial={initial} />
      </div>
    </Panel>
  );
}
