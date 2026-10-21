"use client";

import { useState } from "react";

const HOOKS = [
  { id: "a", hook: "is your family covered if…", cost: "$21", note: "winner" },
  { id: "b", hook: "your work policy ends when…", cost: "$27", note: "testing" },
  { id: "c", hook: "protect your mortgage in 3 minutes", cost: "$38", note: "paused" },
];

/** Same body, different first three seconds. Pick a hook to see how Migz tests them. Frames are drawn, sample numbers. */
export function HookSwap() {
  const [pick, setPick] = useState(0);
  const h = HOOKS[pick];
  return (
    <div className="hs">
      <div className="hs__frames" aria-hidden="true">
        <div className="hs__phone">
          <p className="hs__tag">first 3 seconds</p>
          <p className="hs__hook" key={h.id}>
            {h.hook}
          </p>
          <span className="hs__bar" />
        </div>
        <div className="hs__phone hs__phone--body">
          <p className="hs__tag">the rest, unchanged</p>
          <span className="hs__line" />
          <span className="hs__line hs__line--s" />
          <span className="hs__line" />
          <span className="hs__book">book a call</span>
        </div>
        <div className="hs__square">
          <p className="hs__tag">image ad, 4:5</p>
          <p className="hs__sq">protect their peace</p>
        </div>
      </div>
      <div className="hs__pick" role="radiogroup" aria-label="hook to preview">
        {HOOKS.map((x, i) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={pick === i}
            className={"hs__opt" + (pick === i ? " is-on" : "")}
            onClick={() => setPick(i)}
          >
            <span>{x.hook}</span>
            <span className="hs__meta">
              {x.cost} per booked call · {x.note}
            </span>
          </button>
        ))}
        <p className="hs__sample">sample numbers</p>
      </div>
    </div>
  );
}
