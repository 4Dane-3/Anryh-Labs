"use client";

import { useEffect, useRef, useState } from "react";

/** A looping, muted ad that plays while it's on screen. Tap it for sound; only one plays sound at a time. */
export function ExampleVideo({ src, poster, w, h, label }: { src: string; poster: string; w: number; h: number; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const quiet = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== src) {
        v.muted = true;
        setSound(false);
      }
    };
    window.addEventListener("ex-sound", quiet);
    // People who prefer less motion get the still frame; a tap plays it
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !still) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => {
      window.removeEventListener("ex-sound", quiet);
      io.disconnect();
    };
  }, [src]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    const next = !sound;
    v.muted = !next;
    setSound(next);
    if (next) window.dispatchEvent(new CustomEvent("ex-sound", { detail: src }));
    if (v.paused) v.play().catch(() => {});
  };

  return (
    <button type="button" className="ex__item ex__video" style={{ "--a": w / h } as React.CSSProperties} onClick={toggle} aria-pressed={sound} aria-label={`${label}. ${sound ? "Sound on, tap to mute." : "Tap for sound."}`}>
      <video ref={ref} src={src} poster={poster} muted loop playsInline preload="metadata" />
      <span className="ex__sound" aria-hidden="true">
        {sound ? "sound on" : "tap for sound"}
      </span>
    </button>
  );
}
