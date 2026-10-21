const STEPS = [
  { title: "an ad", body: "migz runs it on facebook and instagram, only in the states you’re licensed in." },
  { title: "your page", body: "the ad opens your own booking page, with your calendar on it." },
  { title: "a booked call", body: "someone picks a time. a lamp lights, and you get a message in slack." },
  { title: "meta learns", body: "migz tells meta who booked, so it shows the next ad to more people like them." },
];

const ROW = 156; // px per step; the drawing and the text rows share it
const X = 72;
const R = 30;

/** Four jacks patched in a chain, with a return cord from the last back to the first. Draws itself once in view. */
export function SignalChain() {
  const ys = STEPS.map((_, i) => ROW / 2 + i * ROW);
  const h = ROW * STEPS.length;

  return (
    <div className="chain" data-draw style={{ "--row": `${ROW}px` } as React.CSSProperties}>
      <svg className="chain__svg" viewBox={`0 0 130 ${h}`} width="130" height={h} aria-hidden="true">
        <path
          className="ch-cord ch-cord--return"
          pathLength={1}
          d={`M ${X} ${ys[3] + R} C ${X - 96} ${h - 6}, ${X - 96} 6, ${X} ${ys[0] - R}`}
          style={{ "--dd": "2300ms" } as React.CSSProperties}
        />
        {ys.slice(0, -1).map((y, i) => (
          <path
            key={i}
            className="ch-cord"
            pathLength={1}
            d={`M ${X} ${y + R} C ${X + 38} ${y + R + 30}, ${X + 38} ${ys[i + 1] - R - 30}, ${X} ${ys[i + 1] - R}`}
            style={{ "--dd": `${500 + i * 520}ms` } as React.CSSProperties}
          />
        ))}
        {ys.map((y, i) => (
          <g key={i} className="ch-node" style={{ "--dd": `${i * 520}ms` } as React.CSSProperties}>
            <circle cx={X} cy={y} r={R} fill="var(--sb-metal)" />
            <circle cx={X} cy={y} r={14} fill={i === 2 ? "var(--sb-accent)" : "var(--sb-ink)"} className={i === 2 ? "ch-lit" : undefined} />
          </g>
        ))}
      </svg>
      <ol className="chain__list">
        {STEPS.map((s, i) => (
          <li key={s.title} data-reveal style={{ "--i": i } as React.CSSProperties}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
