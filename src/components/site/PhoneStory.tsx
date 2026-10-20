const SCREENS = [
  { t: "their phone", h: "your page", b: "your photo, your calendar, your name. no app, no sign-up." },
  { t: "their phone", h: "pick a time", b: "times come from your real availability and can’t double-book." },
  { t: "their phone", h: "a few optional questions", b: "coverage, goals and budget, so you walk in prepared." },
  { t: "your phone", h: "8am in slack", b: "who’s booked today, with their answers beside each call." },
];

export function PhoneStory() {
  return (
    <ol className="ph">
      {SCREENS.map((s, i) => (
        <li key={s.h} data-reveal style={{ "--i": i } as React.CSSProperties}>
          <div className="ph__screen" aria-hidden="true">
            <span className="ph__notch" />
            <span className="ph__blk ph__blk--a" />
            <span className="ph__blk" />
            <span className="ph__blk ph__blk--s" />
            <span className="ph__btn" />
          </div>
          <p className="ph__t">{s.t}</p>
          <h3>{s.h}</h3>
          <p>{s.b}</p>
        </li>
      ))}
    </ol>
  );
}
