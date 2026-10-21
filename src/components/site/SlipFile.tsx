// Sample entries, written the way Migz writes them in an agent's dashboard.
const SLIPS = [
  {
    title: "Held budget steady",
    reason: "The new hooks are still in Meta’s learning phase, so no changes until they have more data.",
    tag: "budget",
    when: "1 day ago",
  },
  {
    title: "Expanded placements to Reels",
    reason: "Feed costs rose 18% this week; Reels was cheaper per click in the test.",
    tag: "placement",
    when: "3 days ago",
  },
  {
    title: "Launched two new hooks on the winning video",
    reason: "Same body, new first three seconds: “Is your family covered if…” and “Your work policy ends when…”.",
    tag: "creative",
    when: "6 days ago",
  },
  {
    title: "Moved $6/day to the mortgage-protection video",
    reason: "It books calls at $21 each versus $38 for the rest of the campaign.",
    tag: "budget",
    when: "11 days ago",
  },
  {
    title: "Paused image ad B",
    reason: "Click-through rate was 0.41% after 2,100 impressions, a third of the other ads.",
    tag: "creative",
    when: "18 days ago",
  },
  {
    title: "Launched “Protect your family” campaign",
    reason: "Three video ads and two images, optimized for booked calls.",
    tag: "launch",
    when: "29 days ago",
  },
];

export function SlipFile() {
  return (
    <ol className="slipfile">
      {SLIPS.map((s, i) => (
        <li key={s.title} className="slipfile__row" data-reveal style={{ "--i": i % 3 } as React.CSSProperties}>
          <h3 className="slipfile__title">{s.title}</h3>
          <p className="slipfile__reason">{s.reason}</p>
          <p className="slipfile__meta">
            {s.tag} · {s.when}
          </p>
        </li>
      ))}
    </ol>
  );
}
