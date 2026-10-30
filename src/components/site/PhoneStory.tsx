import Image from "next/image";

const SCREENS = [
  { t: "their phone", h: "your page", b: "your photo, your calendar, your name. no app, no sign-up.", img: "/phone/demo-page.webp", alt: "An agent's booking page on a phone: photo, name, rating and a booking card" },
  { t: "their phone", h: "pick a time", b: "times come from your real availability and can’t double-book.", img: "/phone/demo-times.webp", alt: "The booking card with a row of days and open call times to tap" },
  { t: "their phone", h: "a few optional questions", b: "coverage, goals and budget, so you walk in prepared.", img: "/phone/demo-prepare.webp", alt: "A confirmation that says you're booked, then optional questions to help the agent prepare" },
  { t: "your phone", h: "8am in slack", b: "who’s booked today, with their answers beside each call.", img: null, alt: "" },
] as const;

/** A lock-screen ping: the morning digest, then a new booking as it comes in. Sample names. */
function Ping() {
  return (
    <div className="ph__ping" role="img" aria-label="Slack notifications on a phone: good morning, you have 2 calls today, and a new call booked">
      <p className="ph__clock">8:00</p>
      <p className="ph__date">friday, october 30</p>
      <div className="ph__note">
        <span className="ph__app">#</span>
        <div>
          <p className="ph__nh">
            <b>slack</b>
            <span>now</span>
          </p>
          <p className="ph__nt">Good morning, Jordan</p>
          <p className="ph__nb">You have 2 calls today: 10:00 AM Dana R. · 1:30 PM Pat L.</p>
        </div>
      </div>
      <div className="ph__note ph__note--b">
        <span className="ph__app">#</span>
        <div>
          <p className="ph__nh">
            <b>slack</b>
            <span>2m ago</span>
          </p>
          <p className="ph__nt">New call booked</p>
          <p className="ph__nb">Chris M. · Sat, Oct 31 at 10:00 AM</p>
        </div>
      </div>
    </div>
  );
}

export function PhoneStory() {
  return (
    <ol className="ph">
      {SCREENS.map((s, i) => (
        <li key={s.h} data-reveal style={{ "--i": i } as React.CSSProperties}>
          <div className="ph__screen">
            {s.img ? <Image src={s.img} alt={s.alt} width={780} height={1688} sizes="(max-width: 900px) 45vw, 22vw" /> : <Ping />}
          </div>
          <p className="ph__t">{s.t}</p>
          <h3>{s.h}</h3>
          <p>{s.b}</p>
        </li>
      ))}
    </ol>
  );
}
