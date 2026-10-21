// Sample reads, one per part of the campaign Migz can change. Illustrative numbers.
const ROWS = [
  {
    lever: "budget",
    saw: "The mortgage-protection video books calls at $21. The rest of the campaign averages $38.",
    did: "Moved $6 a day to the video that books, within your daily cap.",
    metric: "cost per booked call",
    from: 38,
    to: 29,
  },
  {
    lever: "placement",
    saw: "Feed costs rose 18% this week while Reels stayed flat.",
    did: "Expanded to Reels and trimmed Feed to what still booked.",
    metric: "cost per click",
    from: 2.1,
    to: 1.6,
  },
  {
    lever: "creative",
    saw: "The same people saw the main video 5.4 times and click-through fell by half.",
    did: "Made two new hooks on the winning video and launched them as new ads.",
    metric: "click-through rate",
    from: 0.6,
    to: 1.1,
  },
  {
    lever: "pause",
    saw: "One image ad had a 0.41% click-through rate after 2,100 impressions, a third of the others.",
    did: "Paused it and gave its budget to the ads still earning clicks.",
    metric: "campaign click-through rate",
    from: 0.9,
    to: 1.2,
  },
];

const fmt = (n: number, m: string) => (m.includes("cost") ? `$${n}` : m.includes("rate") ? `${n}%` : String(n));

export function Diagnose() {
  return (
    <ol className="dg">
      {ROWS.map((r, i) => (
        <li key={r.lever} className="dg__row" data-reveal style={{ "--i": i } as React.CSSProperties}>
          <span className="dg__lever">{r.lever}</span>
          <div className="dg__col">
            <p className="dg__k">what migz saw</p>
            <p>{r.saw}</p>
          </div>
          <div className="dg__col">
            <p className="dg__k">what it changed</p>
            <p>{r.did}</p>
          </div>
          <div className="dg__col dg__after">
            <p className="dg__k">{r.metric}</p>
            <p className="dg__num">
              <span className="dg__from">{fmt(r.from, r.metric)}</span>
              <span aria-hidden="true"> → </span>
              <span className="dg__to">{fmt(r.to, r.metric)}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
