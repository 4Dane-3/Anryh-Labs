const LIMITS = [
  ["spend", "never more than your daily budget, and never more than 30% of it moved in one step."],
  ["learning", "no edits to an ad while meta is still learning it."],
  ["data", "no judging an ad before it has enough impressions to mean something."],
  ["last ad", "it can’t pause your last live ad."],
  ["claims", "ad copy can’t promise rates, approval or savings. financial-products rules are on by default."],
];

export function Limits() {
  return (
    <ul className="lim">
      {LIMITS.map(([k, v], i) => (
        <li key={k} data-reveal style={{ "--i": i } as React.CSSProperties}>
          <span className="lim__lamp" aria-hidden="true" />
          <h3>{k}</h3>
          <p>{v}</p>
        </li>
      ))}
    </ul>
  );
}
