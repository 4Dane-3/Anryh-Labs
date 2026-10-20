"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import {
  BEATS,
  DAILY_BUDGET,
  DECISIONS,
  INITIAL_ADS,
  LAMPS,
  SETUP_SLIP,
  finishedState,
  type Ad,
  type DecisionId,
  type Slip,
} from "@/components/site/board-data";

type Pending = { id: DecisionId; slip: number };
type State = { ads: Ad[]; calls: number; slips: Slip[]; beat: number; seq: number; pending: Pending | null };

const MAX_SLIPS = 2; // visible at once; one more is kept while it animates out
const START: State = { ads: INITIAL_ADS, calls: 2, slips: [{ id: 0, ...SETUP_SLIP }], beat: 0, seq: 1, pending: null };

const FINISHED = (() => {
  const f = finishedState();
  return {
    ...START,
    ads: f.ads,
    calls: f.calls,
    slips: f.slips.slice().reverse().slice(0, MAX_SLIPS),
    beat: BEATS.length,
    seq: f.slips.length,
  } satisfies State;
})();

type Action =
  | { type: "call" }
  | { type: "decide"; id: DecisionId; propose: boolean }
  | { type: "resolve"; approve: boolean }
  | { type: "reset" };

const pushSlip = (slips: Slip[], slip: Slip) => [slip, ...slips].slice(0, MAX_SLIPS + 1);

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "call":
      return { ...s, calls: Math.min(LAMPS, s.calls + 1), beat: s.beat + 1 };
    case "decide": {
      const d = DECISIONS[a.id];
      const slip: Slip = { id: s.seq, title: d.title, reason: d.reason, tag: d.tag, state: a.propose ? "proposed" : "applied" };
      if (a.propose) {
        return { ...s, slips: pushSlip(s.slips, slip), seq: s.seq + 1, pending: { id: a.id, slip: slip.id } };
      }
      return { ...s, ads: d.apply(s.ads), slips: pushSlip(s.slips, slip), seq: s.seq + 1, beat: s.beat + 1 };
    }
    case "resolve": {
      if (!s.pending) return s;
      const d = DECISIONS[s.pending.id];
      const slips = s.slips.map((sl) =>
        sl.id === s.pending!.slip ? { ...sl, state: a.approve ? ("applied" as const) : ("declined" as const) } : sl,
      );
      return { ...s, ads: a.approve ? d.apply(s.ads) : s.ads, slips, pending: null, beat: s.beat + 1 };
    }
    case "reset":
      // Fresh slip ids so keys of slips still animating out never collide with new ones
      return { ...START, slips: [{ id: s.seq, ...SETUP_SLIP }], seq: s.seq + 1 };
  }
}

// ---------- geometry ----------

type Pt = { x: number; y: number };
type Geo = { w: number; h: number; term: Pt & { r: number }; jacks: (Pt | null)[] };

function bezier(t: number, p0: Pt, c1: Pt, c2: Pt, p1: Pt): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

function controls(sx: number, sy: number, ex: number, ey: number, sag: number): [Pt, Pt] {
  const dx = ex - sx;
  // leave the terminal gently, enter the jack dead level so the plug always sits straight
  return [
    { x: sx + dx * 0.5, y: sy + sag * 0.35 },
    { x: ex - Math.max(dx * 0.5, 24), y: ey },
  ];
}

const EASE = [0.22, 1, 0.36, 1] as const;

function Cord({ start, end, slack, plugged, spend, pulse }: { start: Pt; end: Pt; slack: Pt; plugged: boolean; spend: number; pulse: number }) {
  const target = plugged ? end : slack;
  const sx = useMotionValue(start.x);
  const sy = useMotionValue(start.y);
  const ex = useMotionValue(target.x);
  const ey = useMotionValue(target.y);
  const sag = useMotionValue(plugged ? 16 : 30);
  const width = useMotionValue(plugged ? 3 + spend * 0.55 : 2.5);
  const progress = useMotionValue(0);
  const lastPulse = useRef(pulse);

  useEffect(() => {
    sx.set(start.x);
    sy.set(start.y);
  }, [start.x, start.y, sx, sy]);

  useEffect(() => {
    const opts = { duration: 0.75, ease: EASE };
    const controls = [
      animate(ex, target.x, opts),
      animate(ey, target.y, opts),
      animate(sag, plugged ? 16 : 30, opts),
      animate(width, plugged ? 3 + spend * 0.55 : 2.5, { duration: 0.6, ease: EASE }),
    ];
    return () => controls.forEach((c) => c.stop());
  }, [target.x, target.y, plugged, spend, ex, ey, sag, width]);

  useEffect(() => {
    if (pulse === lastPulse.current) return;
    lastPulse.current = pulse;
    progress.set(0);
    const c = animate(progress, 1, { duration: 1.1, ease: "linear" });
    return () => c.stop();
  }, [pulse, progress]);

  const d = useTransform([sx, sy, ex, ey, sag], ([x0, y0, x1, y1, s]: number[]) => {
    const [c1, c2] = controls(x0, y0, x1 - 20, y1, s);
    return `M ${x0} ${y0} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x1 - 20} ${y1}`;
  });
  const dot = useTransform([progress, sx, sy, ex, ey, sag], ([p, x0, y0, x1, y1, s]: number[]) => {
    const [c1, c2] = controls(x0, y0, x1 - 20, y1, s);
    return bezier(p, { x: x0, y: y0 }, c1, c2, { x: x1 - 20, y: y1 });
  });
  const dotX = useTransform(dot, (p) => p.x);
  const dotY = useTransform(dot, (p) => p.y);
  const dotOpacity = useTransform(progress, [0, 0.06, 0.9, 1], [0, 1, 1, 0]);

  return (
    <g>
      <motion.path d={d} fill="none" stroke="var(--sb-ink)" strokeLinecap="round" style={{ strokeWidth: width }} />
      <motion.g style={{ x: ex, y: ey }}>
        <rect x={-20} y={-6} width={6} height={12} rx={2} fill="var(--sb-ink)" />
        <rect x={-15} y={-5} width={15} height={10} rx={4} fill="var(--sb-metal)" />
      </motion.g>
      <motion.circle r={5} fill="var(--sb-accent)" style={{ cx: dotX, cy: dotY, opacity: dotOpacity }} />
    </g>
  );
}

function Roll({ value }: { value: string | number }) {
  return (
    <span className="bd-roll">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="bd-roll__v"
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const STATE_LABEL: Record<Slip["state"], string> = {
  applied: "done",
  proposed: "waiting for your ok",
  declined: "you declined",
};

export function Board() {
  const reduce = useReducedMotion();
  const [state, dispatch] = useReducer(reducer, START);
  const [mode, setMode] = useState<"auto" | "approve">("auto");
  const [playing, setPlaying] = useState(true);
  const [started, setStarted] = useState(false); // reduced-motion visitors start it themselves
  const [inView, setInView] = useState(true);
  const [tabHidden, setTabHidden] = useState(false);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [pulses, setPulses] = useState<Record<string, number>>({});

  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLSpanElement>(null);
  const jackRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const modeRef = useRef(mode);
  const lastSpend = useRef<Record<string, number>>(Object.fromEntries(INITIAL_ADS.map((a) => [a.id, a.spend])));

  const staticView = !!reduce && !started;
  const s = staticView ? FINISHED : state;
  const running = playing && inView && !tabHidden && !staticView;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Pause when scrolled away or the tab is hidden
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // The script: one beat at a time, each after its own delay
  useEffect(() => {
    if (!running || state.pending || state.beat >= BEATS.length) return;
    const beat = BEATS[state.beat];
    const t = window.setTimeout(() => {
      if (beat.kind === "call") dispatch({ type: "call" });
      else if (beat.kind === "decide")
        dispatch({ type: "decide", id: beat.id, propose: modeRef.current === "approve" && beat.id !== "hold" });
      else dispatch({ type: "reset" });
    }, beat.wait);
    return () => window.clearTimeout(t);
  }, [running, state.pending, state.beat]);

  // Where the jacks and terminal actually are (they move with the layout)
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const term = termRef.current;
    if (!stage || !term) return;
    const sb = stage.getBoundingClientRect();
    const at = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - sb.left + r.width / 2, y: r.top - sb.top + r.height / 2, r: r.width / 2 };
    };
    setGeo({
      w: sb.width,
      h: sb.height,
      term: at(term),
      jacks: jackRefs.current.map((j) => (j ? at(j) : null)),
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measure]);

  // A cord pulses when its ad's share of the budget grows
  const spendKey = s.ads.map((a) => `${a.id}:${a.spend}`).join("|");
  useEffect(() => {
    const grew: Record<string, number> = {};
    for (const a of s.ads) {
      if (a.spend > (lastSpend.current[a.id] ?? 0)) grew[a.id] = 1;
      lastSpend.current[a.id] = a.spend;
    }
    if (Object.keys(grew).length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPulses((p) => {
        const next = { ...p };
        for (const id of Object.keys(grew)) next[id] = (next[id] ?? 0) + 1;
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendKey]);

  const choose = (next: "auto" | "approve") => {
    setMode(next);
    if (next === "auto" && state.pending) dispatch({ type: "resolve", approve: true });
  };

  const togglePlay = () => {
    if (staticView) {
      setStarted(true);
      dispatch({ type: "reset" });
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  const total = s.ads.reduce((sum, a) => sum + a.spend, 0);
  const shownSlips = s.slips.slice(0, MAX_SLIPS);

  return (
    <section ref={rootRef} className="bd" aria-label="Migz demo with sample activity">
      <p className="sr-only">
        Sample activity: Migz paused an image ad with a 0.41% click-through rate, moved $6 a day to the video that books
        calls at $21 each, launched two new hooks on the winning video, and held the budget steady while Meta learns.
      </p>

      <header className="bd-top" aria-hidden="true">
        <div className="bd-calls">
          <p className="bd-label">booked calls today · sample activity</p>
          <ol className="bd-lamps">
            {Array.from({ length: LAMPS }, (_, i) => (
              <li key={i} className="bd-lamp" data-lit={i < s.calls} />
            ))}
          </ol>
        </div>
        <p className="bd-count">
          <Roll value={s.calls} />
        </p>
      </header>

      <div className="bd-body">
        <div className="bd-stage" ref={stageRef} aria-hidden="true">
          <div className="bd-term-col">
            <span className="bd-term" ref={termRef} />
            <p className="bd-term__label">
              budget
              <strong>
                ${DAILY_BUDGET}
                <small>/day</small>
              </strong>
            </p>
          </div>
          <span className="bd-gap" />
          <ul className="bd-ads">
            {s.ads.map((ad, i) => (
              <li key={ad.id} className="bd-ad" data-live={ad.live} data-open={ad.name === "open slot"}>
                <span
                  className="bd-jack"
                  ref={(el) => {
                    jackRefs.current[i] = el;
                  }}
                />
                <span className="bd-ad__lamp" data-lit={ad.live} />
                <span className="bd-ad__body">
                  <span className="bd-ad__name">
                    <Roll value={ad.name} />
                  </span>
                  <span className="bd-ad__kind">
                    {ad.kind}
                    {ad.fresh ? " · new hook" : ""}
                  </span>
                </span>
                <span className="bd-ad__spend">
                  <Roll value={ad.live ? `$${ad.spend}` : "off"} />
                </span>
              </li>
            ))}
          </ul>
          {geo && (
            <svg className="bd-cords" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
              {s.ads.map((ad, i) => {
                const jack = geo.jacks[i];
                if (!jack) return null;
                const start = { x: geo.term.x + geo.term.r * 0.4, y: geo.term.y };
                return (
                  <Cord
                    key={ad.id}
                    start={start}
                    end={{ x: jack.x - 2, y: jack.y }}
                    slack={{ x: start.x + 58, y: geo.term.y + 46 + i * 9 }}
                    plugged={ad.live}
                    spend={ad.spend}
                    pulse={pulses[ad.id] ?? 0}
                  />
                );
              })}
            </svg>
          )}
        </div>

        <aside className="bd-slips" aria-label="What Migz changed, and why (sample)">
          <p className="bd-label">what migz changed, and why</p>
          <ul>
            <AnimatePresence initial={false} mode="popLayout">
              {shownSlips.map((sl) => (
                <motion.li
                  key={sl.id}
                  layout
                  className="bd-slip"
                  data-state={sl.state}
                  initial={{ opacity: 0, y: -18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 14 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="bd-slip__title">{sl.title}</p>
                  <p className="bd-slip__reason">{sl.reason}</p>
                  {sl.state === "proposed" ? (
                    <div className="bd-slip__ask">
                      <button type="button" className="bd-btn bd-btn--go" onClick={() => dispatch({ type: "resolve", approve: true })}>
                        approve
                      </button>
                      <button type="button" className="bd-btn" onClick={() => dispatch({ type: "resolve", approve: false })}>
                        decline
                      </button>
                    </div>
                  ) : (
                    <p className="bd-slip__meta">
                      {sl.tag} · {STATE_LABEL[sl.state]}
                    </p>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </aside>
      </div>

      <footer className="bd-bar">
        <div className="bd-mode" role="group" aria-label="How Migz works">
          <span className="bd-mode__label">migz works</span>
          <div className="bd-seg">
            {(
              [
                ["auto", "automatically"],
                ["approve", "asks me first"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => choose(value)} className="bd-seg__b">
                {mode === value && <motion.span layoutId="bd-seg" className="bd-seg__bg" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
                <span className="bd-seg__t">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="bd-bar__end">
          <p className="bd-note">sample activity, ${total}/day</p>
          <button type="button" className="bd-btn" onClick={togglePlay}>
            {staticView || !playing ? "play" : "pause"}
          </button>
        </div>
      </footer>
    </section>
  );
}
