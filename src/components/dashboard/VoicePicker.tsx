"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { chooseAdVoice, listAdVoices } from "@/app/dashboard/creatives/actions";
import type { AdVoice } from "@/lib/voice/ad-voices";

type Gender = "male" | "female" | null;

/** Pick the voice their ads are spoken in, from ElevenLabs' voices. Our picks are starred and listed first. */
export function VoicePicker({ initial, first, onSaved }: { initial: { id: string | null; name: string | null }; first: { voices: AdVoice[]; more: boolean }; onSaved?: () => void }) {
  const [chosen, setChosen] = useState(initial);
  const [gender, setGender] = useState<Gender>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [voices, setVoices] = useState<AdVoice[]>(first.voices);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(first.more);
  const [loading, setLoading] = useState(false);
  // The first page comes with the page; the list is fetched again only when a filter or page changes
  const [asked, setAsked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const audio = useRef<HTMLAudioElement | null>(null);

  // A new filter starts the list over; "More voices" adds the next page
  useEffect(() => {
    if (!asked) return;
    let live = true;
    listAdVoices({ gender, search: query, page }).then((r) => {
      if (!live) return;
      setLoading(false);
      if (!r.ok) return setError(r.error ?? "Couldn't load the voices.");
      setError(null);
      setVoices((v) => (page === 0 ? (r.voices ?? []) : [...v, ...(r.voices ?? []).filter((n) => !v.some((o) => o.id === n.id))]));
      setMore(!!r.more);
    });
    return () => {
      live = false;
    };
  }, [asked, gender, query, page]);

  useEffect(() => () => audio.current?.pause(), []);

  const play = (id: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    const src = voices.find((v) => v.id === id)?.preview;
    const a = new Audio(`/api/dashboard/voice-preview?id=${id}${src ? `&src=${encodeURIComponent(src)}` : ""}`);
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      setError("That voice has no preview.");
    };
    audio.current = a;
    setPlaying(id);
    void a.play().catch(() => setPlaying(null));
  };

  const choose = (id: string, name: string) =>
    start(async () => {
      const r = await chooseAdVoice(id, name);
      if (!r.ok) return setError(r.error ?? "Couldn't save that.");
      setError(null);
      setChosen({ id, name });
      onSaved?.();
    });

  const filter = (g: Gender) => {
    if (g === gender) return;
    setLoading(true);
    setAsked((n) => n + 1);
    setGender(g);
    setPage(0);
  };
  const find = () => {
    if (search === query) return;
    setLoading(true);
    setAsked((n) => n + 1);
    setQuery(search);
    setPage(0);
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-fg-muted">
        {chosen.id ? (
          <>
            Your ads are spoken by <span className="font-semibold text-fg">{chosen.name}</span>.
          </>
        ) : (
          "Pick the voice for your videos: press play to hear each one. Until you pick, Migz uses its standard narrator."
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {([null, "male", "female"] as Gender[]).map((g) => (
          <button key={g ?? "all"} type="button" onClick={() => filter(g)} className={`rounded-full border px-3 py-1 text-[12px] ${gender === g ? "border-brand text-fg" : "border-line text-fg-muted"}`}>
            {g === "male" ? "Men" : g === "female" ? "Women" : "All"}
          </button>
        ))}
        <div className="flex flex-1 gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              find();
            }}
            placeholder="Search: deep, friendly, southern, young…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-ink-high px-3 py-1.5 text-sm text-fg"
          />
          <button type="button" onClick={find} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg">
            Search
          </button>
        </div>
      </div>
      <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {voices.map((v) => (
          <VoiceCard
            key={v.id}
            id={v.id}
            name={v.name}
            line={[v.tagline, [v.gender, v.age, v.accent].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            detail={v.description}
            starred={v.starred}
            chosen={chosen.id === v.id}
            busy={saving}
            playing={playing === v.id}
            onPlay={play}
            onChoose={choose}
          />
        ))}
        {!loading && !voices.length && !error && <p className="text-[13px] text-fg-muted">No voices match. Try another search.</p>}
      </div>
      {loading ? (
        <p className="text-[13px] text-fg-muted">Loading voices…</p>
      ) : (
        more && (
          <button type="button" onClick={() => {
              setLoading(true);
              setAsked((n) => n + 1);
              setPage((p) => p + 1);
            }} className="rounded-lg border border-line px-4 py-2 text-[13px] text-fg">
            More voices
          </button>
        )
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function VoiceCard(v: { id: string; name: string; line: string; detail?: string | null; starred?: boolean; chosen: boolean; busy: boolean; playing?: boolean; onPlay?: (id: string) => void; onChoose: (id: string, name: string) => void }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${v.chosen ? "border-brand" : "border-line"}`}>
      {v.onPlay ? (
        <button type="button" onClick={() => v.onPlay!(v.id)} aria-label={v.playing ? `Stop ${v.name}` : `Play ${v.name}`} className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-fg">
          {v.playing ? "■" : "▶"}
        </button>
      ) : (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[13px] text-brand">●</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">
          {v.name}
          {v.starred && (
            <span title="One of our picks" aria-label="One of our picks" className="ml-1.5 text-amber-400">
              ★
            </span>
          )}
        </p>
        <p className="text-[12px] text-fg-muted">{v.line}</p>
        {v.detail && <p className="mt-1 line-clamp-2 text-[12px] text-fg-muted">{v.detail}</p>}
      </div>
      <button type="button" onClick={() => v.onChoose(v.id, v.name)} disabled={v.chosen || v.busy} className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${v.chosen ? "bg-brand/15 text-brand" : "border border-line text-fg disabled:opacity-50"}`}>
        {v.chosen ? "Chosen" : "Use"}
      </button>
    </div>
  );
}
