"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { QUOTE_BEST_TIME, QUOTE_CONSENT_TEXT, QUOTE_COVERAGE } from "@/lib/booking/constants";
import { track, trackOnce } from "@/lib/booking/track";
import { collectAttribution, inputClass } from "@/components/booking/BookingWidget";

/**
 * "Not ready to pick a time? Get a free quote": a lighter step under the calendar for visitors who'd leave
 * otherwise. Name and phone, the agent calls back. Folded by default so picking a time stays the main path;
 * with `openForAds` (Migz's call, from the funnel) it starts open for visitors who came from an ad.
 */
export function QuoteForm({ slug, firstName, preview, openForAds = false }: { slug: string; firstName: string; preview: boolean; openForAds?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!openForAds) return;
    const params = new URLSearchParams(window.location.search);
    // Same test as the page's visit tracking: Meta adds fbclid, our ads add utm_source
    const fromAd = params.has("fbclid") || ["meta", "facebook", "fb", "ig", "instagram"].includes((params.get("utm_source") ?? "").toLowerCase());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after hydration
    if (fromAd) setOpen(true);
  }, [openForAds]);
  const [form, setForm] = useState({ name: "", phone: "", coverage: "", bestTime: "", consent: false, company: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="mt-5 flex gap-3 rounded-xl bg-blue-50 p-4 text-sm text-slate-700 ring-1 ring-blue-100" role="status">
        <CheckCircle2 className="size-5 shrink-0 text-blue-700" />
        <p>
          <span className="block font-semibold text-slate-900">Got it. {firstName} will call you{form.bestTime ? ` in the ${form.bestTime.toLowerCase()}` : " soon"}.</span>
          Rather not wait? Pick a time above and it&apos;s set.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-5 border-t border-slate-100 pt-4 text-center">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (!preview) trackOnce("quote_open", "quote_open");
          }}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
        >
          Not ready to pick a time? Get a free quote <ChevronDown className="size-4" />
        </button>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...form, attribution: collectAttribution() }),
      });
      const data = await res.json();
      if (res.ok) {
        track("quote_submit", { coverage: form.coverage || null });
        setSent(true);
        return;
      }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
      on ? "border-blue-700 bg-blue-50 text-blue-800" : "border-slate-300 text-slate-700 hover:border-blue-300"
    }`;

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4 border-t border-slate-100 pt-4">
      <div>
        <h3 className="font-semibold">Get a free quote</h3>
        <p className="text-sm text-slate-500">Leave your number and {firstName} will call you with options.</p>
      </div>
      <div>
        <label htmlFor="quote-name" className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
        <input id="quote-name" required autoComplete="name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="quote-phone" className="mb-1 block text-sm font-medium text-slate-700">Phone number</label>
        <input id="quote-phone" type="tel" required autoComplete="tel" className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">What are you looking for? <span className="font-normal text-slate-400">(optional)</span></legend>
        <div className="flex flex-wrap gap-2">
          {QUOTE_COVERAGE.map((c) => (
            <button key={c} type="button" aria-pressed={form.coverage === c} className={chip(form.coverage === c)} onClick={() => setForm({ ...form, coverage: form.coverage === c ? "" : c })}>
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Best time to call <span className="font-normal text-slate-400">(optional)</span></legend>
        <div className="flex flex-wrap gap-2">
          {QUOTE_BEST_TIME.map((t) => (
            <button key={t} type="button" aria-pressed={form.bestTime === t} className={chip(form.bestTime === t)} onClick={() => setForm({ ...form, bestTime: form.bestTime === t ? "" : t })}>
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      {/* honeypot: hidden from people, irresistible to bots */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        value={form.company}
        onChange={(e) => setForm({ ...form, company: e.target.value })}
      />

      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500">
        <input type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-blue-700" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
        <span>{QUOTE_CONSENT_TEXT}</span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || preview}
        className="flex h-12 w-full items-center justify-center rounded-lg border border-blue-700 bg-white text-base font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : preview ? "Quotes are off in preview" : "Get my free quote"}
      </button>
    </form>
  );
}
