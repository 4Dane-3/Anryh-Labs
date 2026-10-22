"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONSENT_TEXT } from "@/lib/booking/constants";
import { QuestionField } from "@/components/booking/IntakeForm";
import {
  isHidden,
  isRequired,
  missingRequired,
  STEP_TITLES,
  type IntakeQuestion,
} from "@/lib/booking/questions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";

function dayKey(iso: string, tz: string) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function collectAttribution() {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of params) {
    if (key.startsWith("utm_") || key === "fbclid") out[key] = value;
  }
  for (const cookie of document.cookie.split("; ")) {
    const [name, ...rest] = cookie.split("=");
    if (name === "_fbp" || name === "_fbc") out[name] = rest.join("=");
  }
  return out;
}

export function BookingWidget({
  slug,
  firstName,
  preview = false,
  questions = [],
  requiredSteps = [],
}: {
  slug: string;
  firstName: string;
  preview?: boolean;
  /** The agent's required questions (and what they depend on), asked before the booking is confirmed. */
  questions?: IntakeQuestion[];
  requiredSteps?: number[];
}) {
  const router = useRouter();
  // Visitor's timezone; empty during SSR so server and client markup match
  const tz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "", // honeypot
    consent: false,
  });
  // 0 = contact details; then one page per step that has required questions
  const [page, setPage] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const questionSteps = [...new Set(questions.map((q) => q.step))];
  const step = questionSteps[page - 1];
  const pageQuestions = questions.filter((q) => q.step === step && !isHidden(q, values));
  const isLastPage = page === questionSteps.length;

  async function loadSlots() {
    try {
      const res = await fetch(`/api/agents/${slug}/slots`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSlots(data.slots);
      setSlotMinutes(data.slotMinutes);
    } catch {
      setSlots([]);
      setError("Couldn't load times. Please refresh and try again.");
    }
  }

  useEffect(() => {
    // State is only set once the fetch resolves, never synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Count one visit per browser session, tagged with the ad that sent it
  useEffect(() => {
    if (preview) return;
    try {
      const key = `visit:${slug}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: still count the visit
    }
    const params = new URLSearchParams(window.location.search);
    fetch(`/api/agents/${slug}/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utm_source: params.get("utm_source"), utm_content: params.get("utm_content") }),
      keepalive: true,
    }).catch(() => {});
  }, [slug, preview]);

  const days = useMemo(() => {
    if (!slots || !tz) return [];
    const map = new Map<string, string[]>();
    for (const iso of slots) {
      const key = dayKey(iso, tz);
      map.set(key, [...(map.get(key) ?? []), iso]);
    }
    return [...map.entries()].map(([key, times]) => ({ key, times }));
  }, [slots, tz]);

  const activeDay = days.find((d) => d.key === (day ?? days[0]?.key));

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setError(null);

    if (page > 0) {
      const missing = missingRequired(pageQuestions, requiredSteps, values);
      if (missing) return setError(`Please answer "${missing.label}" to book.`);
    }
    if (!isLastPage) {
      setPage(page + 1);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          startsAt: picked,
          ...form,
          // Only answers to questions that are showing, given the other answers
          answers: Object.fromEntries(
            questions.filter((q) => !isHidden(q, values)).map((q) => [q.key, values[q.key] ?? ""]),
          ),
          attribution: collectAttribution(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.token) {
        router.push(`/${slug}/prepare?b=${data.token}&new=1`);
        return;
      }

      setError(data.error ?? "Something went wrong. Please try again.");
      if (res.status === 409) {
        setPicked(null);
        setPage(0);
        await loadSlots();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  if (slots === null || !tz) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (picked) {
    const when = new Date(picked).toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });

    return (
      <form onSubmit={submit} className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setError(null);
            if (page > 0) setPage(page - 1);
            else setPicked(null);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {page > 0 ? "Back" : "Change time"}
        </button>

        <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <div className="font-semibold">
            {when} at {fmtTime(picked)}
          </div>
          <div className="text-blue-800/80">{slotMinutes}-minute call with {firstName}</div>
        </div>

        {page > 0 ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium text-slate-500" aria-live="polite">
                Before you book · {page} of {questionSteps.length} · {STEP_TITLES[step - 1]}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {firstName} asks these before confirming your call. Questions marked{" "}
                <span className="text-red-600">*</span> are required.
              </p>
            </div>
            {pageQuestions.map((q) => (
              <QuestionField
                key={q.key}
                question={q}
                required={isRequired(q, requiredSteps)}
                value={values[q.key] ?? ""}
                onChange={(v) => setValues((cur) => ({ ...cur, [q.key]: v }))}
              />
            ))}
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
                Full name
              </label>
              <input
                id="name"
                required
                autoComplete="name"
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                required
                autoComplete="tel"
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

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
              <input
                type="checkbox"
                required
                className="mt-0.5 size-4 shrink-0 accent-blue-700"
                checked={form.consent}
                onChange={(e) => setForm({ ...form, consent: e.target.checked })}
              />
              <span>{CONSENT_TEXT}</span>
            </label>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          type="submit"
          size="lg"
          disabled={submitting || (preview && isLastPage)}
          className="h-12 w-full bg-blue-700 text-base hover:bg-blue-800"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : !isLastPage ? (
            "Continue"
          ) : preview ? (
            "Booking is off in preview"
          ) : (
            "Confirm booking"
          )}
        </Button>
      </form>
    );
  }

  if (!days.length) {
    return (
      <div className="py-10 text-center text-slate-500">
        <p className="font-medium text-slate-700">No times available right now.</p>
        <p className="mt-1 text-sm">Please check back soon.</p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Pick a day</div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {days.slice(0, 15).map(({ key, times }) => {
            const date = new Date(times[0]);
            const selected = key === activeDay?.key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDay(key)}
                className={`rounded-lg border px-1 py-2 text-center transition-colors ${
                  selected
                    ? "border-blue-700 bg-blue-700 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-400"
                }`}
              >
                <div className="text-[11px] uppercase tracking-wide opacity-80">
                  {date.toLocaleDateString([], { weekday: "short", timeZone: tz })}
                </div>
                <div className="text-lg font-semibold leading-tight">
                  {date.toLocaleDateString([], { day: "numeric", timeZone: tz })}
                </div>
                <div className="text-[11px] opacity-80">
                  {date.toLocaleDateString([], { month: "short", timeZone: tz })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeDay && (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">Pick a time</div>
          <div className="grid grid-cols-3 gap-2">
            {activeDay.times.map((iso) => (
              <button
                key={iso}
                type="button"
                onClick={() => setPicked(iso)}
                className="rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-800 transition-colors hover:border-blue-700 hover:bg-blue-50"
              >
                {fmtTime(iso)}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Globe className="size-3.5" /> Times shown in {tz.replace(/_/g, " ")}
      </p>
    </div>
  );
}
