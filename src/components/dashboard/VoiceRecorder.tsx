"use client";

import { useEffect, useRef, useState } from "react";
import { createCreativeUpload } from "@/app/dashboard/actions";
import { addPresenterFile, saveVoiceConsent } from "@/app/dashboard/creatives/actions";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";

// Their voice, recorded right here: they read a few lines out loud and Migz clones it (ElevenLabs). The lines cover
// what the ads say (towns, roofs, numbers, a question, a laugh-y aside) so the clone has their real range, not
// one flat reading voice.

const MIN_SECONDS = 45;
const MAX_SECONDS = 180;

function lines(name: string, company: string) {
  return [
    `Hey, I'm ${name || "[your name]"}, and I own ${company || "[your company]"}.`,
    "We've been putting roofs on homes around here for a long time, and honestly? I still love it.",
    "See that moss on the north side? That's holding water against your shingles all winter long.",
    "If you've got a stain on your ceiling, don't wait on it. Seriously, give us a call.",
    "We'll come out, get up on the roof, take photos, and walk you through every single one.",
    "Is it a full replacement? Maybe. Maybe not. Most of the time it's a couple hundred bucks of repairs.",
    "Right now we're doing a thousand dollars off a full roof replacement, through the end of the month.",
    "Tap Learn More, pick a time, and we'll see you out there. Thanks for watching!",
  ];
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceRecorder({ name, company, have, consented: consentedAtStart, onDone }: { name: string; company: string; have: "ready" | "saved" | null; consented: boolean; onDone: (message?: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "review" | "saving">("idle");
  const [consented, setConsented] = useState(consentedAtStart);
  const [agree, setAgree] = useState(false);
  const [signer, setSigner] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
  };

  const startRec = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      const type = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: (r.mimeType || type || "audio/webm").split(";")[0] });
        setTake({ blob, url: URL.createObjectURL(blob) });
        setState("review");
      };
      rec.current = r;
      r.start(1000);
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Couldn't use your microphone. Allow it in your browser, or upload a recording instead.");
    }
  };

  const save = async () => {
    if (!take) return;
    setState("saving");
    setError(null);
    try {
      const type = take.blob.type || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : "webm";
      const started = await createCreativeUpload({ name: `voice-sample.${ext}`, type, size: take.blob.size });
      if (!started.ok) throw new Error(started.error);
      await uploadToSignedUrl(started.signedUrl, new File([take.blob], `voice-sample.${ext}`, { type }), () => {});
      const saved = await addPresenterFile("voice", started.path);
      if (!saved.ok) throw new Error(saved.error);
      setTake(null);
      setState("idle");
      setDone(saved.message ?? "Saved.");
      onDone(saved.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the recording.");
      setState("review");
    }
  };

  const consent = async () => {
    setError(null);
    const r = await saveVoiceConsent(signer);
    if (r.ok) setConsented(true);
    else setError(r.error ?? "Couldn't save that.");
  };

  if (!consented)
    return (
      <div className="space-y-3 rounded-lg border border-line p-4">
        <p className="text-sm font-semibold text-fg">Your voice</p>
        <label className="flex items-start gap-2 text-sm text-fg">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
          <span>The voice I record is mine, or the speaker agreed in writing. I allow it to be used to make ads for my business.</span>
        </label>
        <label className="block text-sm text-fg">
          Your full name (the person agreeing)
          <input value={signer} onChange={(e) => setSigner(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink-high px-3 py-2 text-sm text-fg" />
        </label>
        <button type="button" onClick={consent} disabled={!agree || signer.trim().length < 2} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
          Agree and record
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );

  return (
    <div className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-fg">
          Record your voice{" "}
          {have && !done && <span className="font-normal text-fg-muted">({have === "ready" ? "your voice is ready" : "recording saved, voice coming"}: record again to replace it)</span>}
        </p>
        {state === "recording" && <span className="text-[13px] tabular-nums text-red-400">● {fmt(seconds)}</span>}
      </div>
      <p className="text-[12px] text-fg-muted">
        A quiet room, phone or laptop about a foot away. Read these the way you&apos;d say them to a neighbor in their driveway, not like reading: pause, speed up, go off script if it feels natural. Read them twice if you finish early. At least {MIN_SECONDS} seconds; a minute or two is best.
      </p>
      <ol className="list-decimal space-y-1.5 rounded-lg bg-white/[0.04] py-3 pl-8 pr-3 text-[14px] leading-snug text-fg">
        {lines(name, company).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {state === "recording" ? (
          <button type="button" onClick={stop} disabled={seconds < MIN_SECONDS} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {seconds < MIN_SECONDS ? `Keep going (${MIN_SECONDS - seconds}s)` : "Stop"}
          </button>
        ) : (
          <button type="button" onClick={startRec} disabled={state === "saving"} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
            {take ? "Record again" : "Start recording"}
          </button>
        )}
        {take && state !== "recording" && (
          <>
            <audio src={take.url} controls className="h-9" />
            <button type="button" onClick={save} disabled={state === "saving"} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
              {state === "saving" ? "Making their voice…" : "Use this recording"}
            </button>
          </>
        )}
      </div>
      {done && <p className="text-sm text-fg-muted">{done}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
