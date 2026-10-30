"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Clapperboard, MapPin, MessageSquare, PauseCircle, Shuffle } from "lucide-react";
import { DEMO_MAILTO } from "@/lib/contact";

const FEATURES = [
  { icon: Activity, text: "reads your meta numbers all day" },
  { icon: Shuffle, text: "moves budget to what books calls" },
  { icon: PauseCircle, text: "pauses ads that aren’t working" },
  { icon: Clapperboard, text: "makes new images and videos" },
  { icon: MessageSquare, text: "sends you a slack summary at 8am" },
];

/** A row of thin ticks of varying height, like a day of activity; the same every render. */
function Ticks({ seed }: { seed: number }) {
  const bars = Array.from({ length: 56 }, (_, i) => {
    const x = Math.sin((i + 1) * 12.9898 * seed) * 43758.5453;
    return 25 + Math.round((x - Math.floor(x)) * 75);
  });
  return (
    <span className="gh-ticks" aria-hidden="true">
      {bars.map((h, i) => (
        <i key={i} style={{ height: `${h}%`, animationDelay: `${(i % 14) * 90}ms` }} />
      ))}
    </span>
  );
}

/** Full-screen opener: the headline bottom left, a glass card of Migz AI at work top right, what it does along the bottom. */
export function GlassHero() {
  const [on, setOn] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setOn((i) => (i + 1) % FEATURES.length), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="gh" aria-labelledby="gh-title">
      <aside className="gh-live" aria-label="Sample of Migz AI at work">
        <span className="gh-live__grip" aria-hidden="true" />
        <p className="gh-live__where">
          <MapPin aria-hidden="true" /> migz ai · watching 6 ads in meta
        </p>
        <div className="gh-card">
          <div className="gh-card__top">
            <b>final expense video</b>
            <span>
              <i className="gh-dot gh-dot--good" /> winning
            </span>
          </div>
          <div className="gh-card__row">
            <div>
              <small>cost per call</small>
              <strong>$11</strong>
            </div>
            <span className="gh-chip">+$12/day</span>
            <div className="gh-card__end">
              <small>budget</small>
              <strong>$32/day</strong>
            </div>
          </div>
          <Ticks seed={1.7} />
        </div>
        <div className="gh-card">
          <div className="gh-card__top">
            <b>“protect their peace” image</b>
            <span>
              <i className="gh-dot" /> paused
            </span>
          </div>
          <div className="gh-card__row">
            <div>
              <small>spent</small>
              <strong>$38</strong>
            </div>
            <span className="gh-chip">4 days</span>
            <div className="gh-card__end">
              <small>booked</small>
              <strong>0</strong>
            </div>
          </div>
          <Ticks seed={3.1} />
        </div>
        <p className="gh-live__note">sample activity</p>
      </aside>

      <div className="gh-main">
        <div className="gh-copy">
          <h1 className="gh-h1" id="gh-title">
            <span>ai meta ads automation</span>
            <span>for insurance agents</span>
          </h1>
          <p className="gh-lead">
            migz ai runs your whole meta campaign automatically. it reads the analytics all day, works out what is holding
            results back, and fixes it: budget, placements, creative and copy.
          </p>
        </div>
        <div className="gh-actions">
          <a href={DEMO_MAILTO} className="gh-btn gh-btn--white">
            reach out <ArrowUpRight aria-hidden="true" />
          </a>
          <Link href="/#how" className="gh-btn gh-btn--text">
            see how it works <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </div>

      <ul className="gh-feats" style={{ "--on": on, "--n": FEATURES.length } as React.CSSProperties}>
        {FEATURES.map(({ icon: Icon, text }, i) => (
          <li key={text} className={i === on ? "is-on" : undefined}>
            <Icon aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p className="gh-invite">invite only, while we onboard agents one at a time.</p>
    </section>
  );
}
