"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { saveInboundSettings } from "@/app/dashboard/actions";
import { Badge, Button, Label, Panel, Switch, inputClass } from "@/components/dashboard/ui";
import { displayPhone } from "@/lib/booking/call";
import { INBOUND_MODE_COPY, INBOUND_MODES, INBOUND_PRICE_DOLLARS, type InboundMode, type InboundPrefs } from "@/lib/voice/inbound-rules";
import { cn } from "@/lib/utils";

type Initial = { on: boolean; mode: InboundMode; number: string | null; transferNumber: string; summaryEmail: string; accountEmail: string; prefs: InboundPrefs };

/** How to point calls at Emma, for the mode they chose, once their number is assigned. */
function Setup({ mode, number }: { mode: InboundMode; number: string }) {
  const [copied, setCopied] = useState(false);
  const digits = number.replace(/\D/g, "");
  const shown = displayPhone(number);
  const copy = () =>
    navigator.clipboard?.writeText(shown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="space-y-2 rounded-xl border border-brand/30 bg-brand/[0.06] px-4 py-3 text-[13px] text-fg-muted">
      <div className="flex items-center gap-2">
        <span className="text-fg-faint">Emma&apos;s number for you</span>
        <code className="rounded-md bg-white/[0.06] px-2 py-0.5 font-semibold text-fg">{shown}</code>
        <button type="button" onClick={copy} aria-label="Copy number" className="rounded-md p-1 text-fg-muted hover:bg-white/[0.06] hover:text-fg">
          {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
        </button>
      </div>
      {mode === "forward" && (
        <>
          <p className="text-fg">Turn on &quot;forward when no answer&quot; on your business line, pointing at this number. From that phone, dial:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>
              AT&amp;T or T-Mobile: <code className="text-fg">**61*1{digits.slice(-10)}#</code> (and <code className="text-fg">**67*1{digits.slice(-10)}#</code> for busy)
            </li>
            <li>
              Verizon: <code className="text-fg">*71{digits.slice(-10)}</code> (covers no answer and busy)
            </li>
            <li>An office or VoIP line (RingCentral, Google Voice, Grasshopper…): set &quot;forward unanswered calls&quot; in its app.</li>
          </ul>
          <p>If a code doesn&apos;t work, your carrier can turn it on in a minute over the phone. Then call your number from another phone, let it ring, and you&apos;ll hear Emma.</p>
        </>
      )}
      {mode === "direct" && <p className="text-fg">Put this number on your website, Google Business Profile, ads, trucks and cards. Emma answers every call.</p>}
      {mode === "mix" && <p className="text-fg">Use this number on your ads and landing page. Keep your own number everywhere else.</p>}
    </div>
  );
}

export function InboundCallsForm({ initial, ready, clinic = false }: { initial: Initial; ready: boolean; clinic?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ on: initial.on, mode: initial.mode, transferNumber: initial.transferNumber, summaryEmail: initial.summaryEmail, prefs: initial.prefs });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const setPrefs = (p: Partial<InboundPrefs>) => setForm({ ...form, prefs: { ...form.prefs, ...p } });
  const save = (next = form) =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const res = await saveInboundSettings({ on: next.on, mode: next.mode, transferNumber: next.transferNumber, summaryEmail: next.summaryEmail, prefs: next.prefs });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    });

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Inbound calls</h2>
            <Badge>+${INBOUND_PRICE_DOLLARS}/month</Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {clinic
              ? "Emma answers your incoming calls. New patients (18 and over) get a free consultation booked on your calendar. Existing patients, suppliers and everyone else get a message taken or are passed to you. You get an email summary of every call."
              : "Emma answers your incoming calls. New homeowners get qualified and booked on your calendar. Existing customers, suppliers and everyone else get a message taken or are passed to you. You get an email summary of every call."}
          </p>
          {!ready && <p className="mt-1 text-[13px] text-fg-muted">Inbound calls aren&apos;t available yet: the inbound line is still being set up.</p>}
        </div>
        <Switch
          checked={form.on}
          label="Inbound calls"
          disabled={pending || (!ready && !form.on)}
          onChange={(on) => {
            const next = { ...form, on };
            setForm(next);
            save(next);
          }}
        />
      </div>

      {form.on && (
        <div className="space-y-5 border-t border-line px-5 py-4">
          {initial.on && initial.number ? (
            <Setup mode={initial.mode} number={initial.number} />
          ) : (
            <p className="rounded-xl border border-line px-4 py-3 text-[13px] text-fg-muted">We&apos;re setting up your number. It shows up here within a business day, with how to point your calls at it. Nothing changes on your phone until then.</p>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-fg">How calls reach Emma</legend>
            <div className="grid gap-2">
              {INBOUND_MODES.map((m) => {
                const on = form.mode === m;
                return (
                  <label key={m} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors", on ? "border-brand/50 bg-brand/10" : "border-line hover:border-line-strong")}>
                    <input type="radio" name="inbound-mode" className="mt-1 accent-[var(--color-brand)]" checked={on} onChange={() => setForm({ ...form, mode: m })} />
                    <span>
                      <span className="block text-sm font-medium text-fg">
                        {INBOUND_MODE_COPY[m].label}
                        {m === "forward" && <span className="ml-2 text-[12px] font-normal text-brand">Recommended</span>}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-fg-muted">{INBOUND_MODE_COPY[m].detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="in-transfer">Transfer calls to</Label>
              <input id="in-transfer" inputMode="tel" className={inputClass} placeholder="Your cell, e.g. (253) 555-0100" value={form.transferNumber} onChange={(e) => setForm({ ...form, transferNumber: e.target.value })} />
              <p className="mt-1 text-[12px] text-fg-muted">Use a cell, not the line that forwards to Emma, or the call loops back to her. Blank: Emma takes a message instead.</p>
            </div>
            <div>
              <Label htmlFor="in-email">Send call summaries to</Label>
              <input id="in-email" type="email" className={inputClass} placeholder={initial.accountEmail} value={form.summaryEmail} onChange={(e) => setForm({ ...form, summaryEmail: e.target.value })} />
              <p className="mt-1 text-[12px] text-fg-muted">Blank: your account email.</p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              ["transfer_existing", clinic ? "Pass existing patients straight to you" : "Pass existing customers straight to you", "Otherwise Emma takes a message."],
              ["transfer_urgent", "Pass urgent calls straight to you", clinic ? "A patient with a concern after their procedure." : "Water coming in right now, storm damage, a tarp needed today."],
            ].map(([k, title, hint]) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-fg">{title}</p>
                  <p className="text-[13px] text-fg-muted">{hint}</p>
                </div>
                <Switch checked={form.prefs[k as "transfer_existing"]} label={title} disabled={pending || !form.transferNumber.trim()} onChange={(v) => setPrefs({ [k]: v })} />
              </div>
            ))}
          </div>

          <div>
            <Label htmlFor="in-tone">How Emma sounds</Label>
            <select id="in-tone" className={`${inputClass} sm:w-60`} value={form.prefs.tone} onChange={(e) => setPrefs({ tone: e.target.value === "formal" ? "formal" : "casual" })}>
              <option value="casual">Friendly and casual</option>
              <option value="formal">Polished and formal</option>
            </select>
          </div>

          <div>
            <Label htmlFor="in-faqs">Answers to common questions</Label>
            <textarea
              id="in-faqs"
              rows={4}
              className={inputClass}
              placeholder={
                clinic
                  ? "Where: 123 Main St, Suite 200, free parking.\nConsultations: in person or by video, about 30 minutes.\nThe surgeon: Dr. Lee does every consultation.\nHow soon: consultations within a week."
                  : "Financing: yes, through GreenSky, 0% for 12 months.\nWarranty: 10-year workmanship, manufacturer warranty on materials.\nBrands: GAF and Owens Corning.\nHow soon: inspections within 2 days."
              }
              value={form.prefs.faqs}
              onChange={(e) => setPrefs({ faqs: e.target.value })}
            />
            <p className="mt-1 text-[12px] text-fg-muted">Emma only answers from this. Anything else, she says the team will follow up. She never quotes prices.</p>
          </div>

          <div>
            <Label htmlFor="in-notes">Anything else Emma should know</Label>
            <textarea id="in-notes" rows={2} className={inputClass} placeholder={clinic ? "Ask for Maria at the front desk about an existing booking." : "We don't do flat roofs. Ask for Mike if it's about an existing job."} value={form.prefs.notes} onChange={(e) => setPrefs({ notes: e.target.value })} />
            <p className="mt-1 text-[12px] text-fg-muted">{clinic ? "She never quotes prices, promises results or comments on anyone's hair." : "The jobs you take (Jobs you take, above) apply to her bookings too."}</p>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => save()} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {saved && <span className="text-[13px] text-good">Saved</span>}
            {error && <span className="text-[13px] text-bad">{error}</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}
