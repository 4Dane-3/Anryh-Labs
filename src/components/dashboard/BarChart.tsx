"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { compact, usd } from "@/lib/dashboard/format";

type Point = { date: string; value: number };
type Format = "usd" | "number";

const HEIGHT = 168;
const PAD = { top: 8, right: 4, bottom: 22, left: 40 };

function fmt(value: number, format: Format, short = false) {
  if (format === "usd") return short ? `$${compact(value / 100)}` : usd(value);
  return short ? compact(value) : value.toLocaleString();
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= max / 4)! * pow;
  return Math.ceil(max / step) * step;
}

/** Path for a column with a 4px rounded top and a square base. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/**
 * Single-series daily column chart. One series, so no legend: the panel title names it.
 * Hover (or focus) shows a tooltip; a visually hidden table carries the same numbers.
 */
export function BarChart({
  data,
  format,
  label,
}: {
  data: Point[];
  format: Format;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const ticks = [0, max / 2, max];
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const band = data.length ? innerW / data.length : 0;
  const barW = Math.min(24, Math.max(2, band - 2)); // 2px surface gap between neighbors
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const dayLabel = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

  const hovered = hover !== null ? data[hover] : null;
  const tooltipLeft = hover !== null ? PAD.left + band * hover + band / 2 : 0;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-fg-faint text-[10px] tabular-nums"
              >
                {fmt(t, format, true)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const h = Math.max(0, y(0) - y(d.value));
            const x = PAD.left + band * i + (band - barW) / 2;
            return (
              <g key={d.date}>
                {h > 0 && (
                  <motion.path
                    d={columnPath(x, y(d.value), barW, h)}
                    className={hover === null || hover === i ? "fill-brand" : "fill-brand/35"}
                    initial={reduce ? false : { scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    style={{ originY: `${y(0)}px` }}
                    transition={{ duration: 0.45, delay: reduce ? 0 : i * 0.012, ease: [0.25, 0.8, 0.25, 1] }}
                  />
                )}
                {/* Hit target spans the whole band, much bigger than the mark */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={-1}
                />
              </g>
            );
          })}

          {/* Sparse x labels: first, middle, last */}
          {[0, Math.floor(data.length / 2), data.length - 1]
            .filter((i, idx, arr) => data[i] && arr.indexOf(i) === idx)
            .map((i) => (
              <text
                key={i}
                x={PAD.left + band * i + band / 2}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                className="fill-fg-faint text-[10px]"
              >
                {dayLabel(data[i].date)}
              </text>
            ))}
        </svg>
      )}

      <AnimatePresence>
        {hovered && (
          <motion.div
            key="tip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, left: tooltipLeft }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-ink px-2.5 py-1.5 text-xs shadow-lg"
          >
            <div className="text-fg-muted">{dayLabel(hovered.date)}</div>
            <div className="font-semibold tabular-nums text-fg">{fmt(hovered.value, format)}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tables ignore the 1px width sr-only relies on, so the wrapper does the hiding */}
      <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{fmt(d.value, format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
