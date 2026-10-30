"use client";

import { useEffect, useState } from "react";

// The kinds of work, by what they do (never by model or tool)
const KIND = {
  rules: { label: "rules", color: "#8fe0aa" },
  quick: { label: "quick read", color: "#8fbfff" },
  analysis: { label: "analysis", color: "#ffb36b" },
  deep: { label: "deep thinking", color: "#c3b2ff" },
  creative: { label: "creative generation", color: "#f1d27a" },
} as const;

const STAGES = ["sense", "audit", "research", "decide", "watch", "advise", "create", "act", "remember"];

// One sample review, start to finish. Details are illustrative and shown blurred.
const RUN: { stage: number; title: string; kind: keyof typeof KIND; detail: string }[] = [
  { stage: 0, title: "reading meta", kind: "rules", detail: "pulled 14 days of results for 6 ads" },
  { stage: 1, title: "checking setup", kind: "quick", detail: "placements, budgets and tracking look right" },
  { stage: 2, title: "researching", kind: "quick", detail: "what final expense ads are winning this week" },
  { stage: 3, title: "deciding", kind: "analysis", detail: "the video books calls at $21, two images haven't booked" },
  { stage: 4, title: "watching", kind: "rules", detail: "41% of page visitors pick a time" },
  { stage: 5, title: "advising", kind: "deep", detail: "move $12/day to the video, pause the weakest image" },
  { stage: 6, title: "making a new hook", kind: "creative", detail: "a new opening for the winning video" },
  { stage: 7, title: "changing ads", kind: "rules", detail: "budget moved and image paused, inside your limits" },
  { stage: 8, title: "taking notes", kind: "quick", detail: "video hooks beat images for this agent" },
];

const STEP_MS = 1900;

/** A looping preview of a Migz AI review: the stages light up in turn and each step lands in the feed. */
export function BrainPreview() {
  // How many steps have started. It starts on the finished run (also what reduced motion sees), then loops
  const [at, setAt] = useState(RUN.length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setAt((n) => (n >= RUN.length + 1 ? 0 : n + 1)), STEP_MS);
    return () => clearInterval(id);
  }, []);
  const started = RUN.slice(0, Math.min(at + 1, RUN.length));
  const current = at < RUN.length ? at : -1;
  const feed = started.slice(-4).reverse();

  return (
    <div className="bp" aria-label="Preview of the Migz AI Brain running a review, with sample details blurred">
      <span className="bp__grip" aria-hidden="true" />
      <p className="bp__head">
        <i className={current >= 0 ? "bp__live is-on" : "bp__live"} aria-hidden="true" />
        <b>migz ai brain</b>
        <span>{current >= 0 ? "reviewing your campaign" : "review done · next check in 6 hours"}</span>
      </p>

      <ol className="bp__stages" aria-hidden="true">
        {STAGES.map((s, i) => {
          const done = started.some((r) => r.stage === i) && current !== i;
          return (
            <li key={s} className={current >= 0 && RUN[current].stage === i ? "is-now" : done ? "is-done" : undefined}>
              <span />
              <small>{s}</small>
            </li>
          );
        })}
      </ol>

      <ul className="bp__feed" aria-hidden="true">
        {feed.map((r) => {
          const now = RUN[current] === r;
          return (
            <li key={r.title} className={now ? "is-now" : undefined}>
              <div className="bp__row">
                <b>{r.title}</b>
                <span>
                  <i style={{ background: KIND[r.kind].color }} />
                  {KIND[r.kind].label}
                </span>
              </div>
              <p className="bp__detail">{now ? "working…" : r.detail}</p>
            </li>
          );
        })}
      </ul>
      <p className="bp__note">a preview with sample details, blurred. your dashboard shows the real thing, live.</p>
    </div>
  );
}
