// How Migz AI makes and improves creative, drawn as four cartoon panels instead of showing real ads: it studies
// long-running ads (via trackers that mirror the Meta Ad Library), makes 10–13 creatives on different angles,
// lets Meta's delivery test them, then from week two (and every two weeks after) pauses the weak ones and builds
// new ones from the winners (lib/migz/cycle.ts).
// Pure SVG with the site's glass tokens; each panel animates once when it scrolls in (nothing moves for people
// who prefer less motion).

const LIME = "var(--lime, #c8f26a)";
const ORANGE = "var(--sb-accent, #ff8a5c)";
const INK = "var(--navy, #0b1a3e)";
const LINE = "rgb(255 255 255 / 0.9)";
const SOFT = "rgb(255 255 255 / 0.14)";
const SOFTER = "rgb(255 255 255 / 0.08)";

type Icon = "price" | "noexam" | "family" | "home" | "age" | "story" | "shield" | "clock" | "flower";

/** The little angle mark in the middle of an ad card. */
function Glyph({ kind, x, y, s = 1, color = LINE }: { kind: Icon; x: number; y: number; s?: number; color?: string }) {
  const t = `translate(${x} ${y}) scale(${s})`;
  const sw = 2.2 / s;
  switch (kind) {
    case "price":
      return (
        <text x={x} y={y + 6 * s} textAnchor="middle" fontSize={18 * s} fontWeight={800} fill={color}>
          $
        </text>
      );
    case "age":
      return (
        <text x={x} y={y + 5 * s} textAnchor="middle" fontSize={13 * s} fontWeight={800} fill={color}>
          50+
        </text>
      );
    case "noexam":
      return (
        <g transform={t} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <rect x={-7} y={-9} width={14} height={18} rx={2.5} />
          <path d="M -3.5 0.5 L -0.8 3.2 L 4 -2.5" />
        </g>
      );
    case "family":
      return (
        <path
          transform={t}
          d="M 0 8 C -10 1 -9 -7 -4 -7 C -1.5 -7 0 -5 0 -3.5 C 0 -5 1.5 -7 4 -7 C 9 -7 10 1 0 8 Z"
          fill={color}
        />
      );
    case "home":
      return (
        <g transform={t} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round">
          <path d="M -8 0 L 0 -7 L 8 0 L 8 8 L -8 8 Z" />
          <path d="M -2 8 L -2 3 L 2 3 L 2 8" />
        </g>
      );
    case "story":
      return (
        <g transform={t}>
          <path d="M -9 -7 H 9 V 4 H -1 L -5 8 V 4 H -9 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M 0 -4.5 L 1.2 -1.6 L 4 -1.4 L 1.8 0.4 L 2.5 3 L 0 1.5 L -2.5 3 L -1.8 0.4 L -4 -1.4 L -1.2 -1.6 Z" fill={color} />
        </g>
      );
    case "shield":
      return <path transform={t} d="M 0 -8 L 7 -5 V 0 C 7 4.5 3.5 7.5 0 8.5 C -3.5 7.5 -7 4.5 -7 0 V -5 Z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />;
    case "clock":
      return (
        <g transform={t} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
          <circle r={7.5} />
          <path d="M 0 -4 V 0 L 3 2" />
        </g>
      );
    case "flower":
      return (
        <g transform={t} fill={color}>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx={0} cy={-4.2} rx={2.6} ry={4} transform={`rotate(${a})`} />
          ))}
          <circle r={2.4} fill={INK} />
        </g>
      );
  }
}

/** A cartoon ad: picture area with an angle mark, two text lines, a button. */
function AdCard({ x, y, w = 46, h = 60, icon, tint = SOFT, mark = LINE, dim = false, glow = false, className, style }: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  icon: Icon;
  tint?: string;
  mark?: string;
  dim?: boolean;
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const pic = h * 0.52;
  return (
    <g className={className} style={{ ...style, transformBox: "fill-box", transformOrigin: "center" }} opacity={dim ? 0.38 : 1}>
      {glow && <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={11} fill="none" stroke={LIME} strokeWidth={3} opacity={0.9} />}
      <rect x={x} y={y} width={w} height={h} rx={8} fill="rgb(255 255 255 / 0.16)" stroke={LINE} strokeWidth={1.6} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={pic} rx={5} fill={tint} />
      <Glyph kind={icon} x={x + w / 2} y={y + 4 + pic / 2} s={w / 46} color={mark} />
      <rect x={x + 5} y={y + pic + 9} width={w * 0.62} height={3.5} rx={1.75} fill={LINE} opacity={0.85} />
      <rect x={x + 5} y={y + pic + 16} width={w * 0.4} height={3} rx={1.5} fill={LINE} opacity={0.5} />
      <rect x={x + w - 17} y={y + h - 11} width={12} height={6} rx={3} fill={LIME} />
    </g>
  );
}

/** Migz, the mascot: a round little robot with an antenna. */
function Bot({ x, y, s = 1, className }: { x: number; y: number; s?: number; className?: string }) {
  return (
    // Placed by the outer group, animated by the inner one (a CSS transform would replace the placement)
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className={className} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
      <path d="M 0 -30 V -40" stroke={LINE} strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={0} cy={-43} r={4} fill={LIME} className="cc-blink" />
      <rect x={-24} y={-30} width={48} height={40} rx={14} fill="#fff" />
      <rect x={-17} y={-22} width={34} height={22} rx={9} fill={INK} />
      <circle cx={-7} cy={-11} r={3.4} fill={LIME} className="cc-eyes" />
      <circle cx={7} cy={-11} r={3.4} fill={LIME} className="cc-eyes" />
      <path d="M -5 4 Q 0 7.5 5 4" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />
      <rect x={-17} y={12} width={34} height={20} rx={9} fill="rgb(255 255 255 / 0.85)" />
      <circle cx={0} cy={22} r={3.5} fill={ORANGE} />
      </g>
    </g>
  );
}

const Sparkle = ({ x, y, s = 1, className, style }: { x: number; y: number; s?: number; className?: string; style?: React.CSSProperties }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path
      className={className}
      style={{ ...style, transformBox: "fill-box", transformOrigin: "center" }}
      d="M 0 -7 C 0.8 -2 2 -0.8 7 0 C 2 0.8 0.8 2 0 7 C -0.8 2 -2 0.8 -7 0 C -2 -0.8 -0.8 -2 0 -7 Z"
      fill={LIME}
    />
  </g>
);

const d = (ms: number) => ({ "--cd": `${ms}ms` }) as React.CSSProperties;

/** 1. Studying long-running ads in an ad-library window, magnifier in hand. */
function Study() {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="Migz AI's robot looking through a magnifying glass at long-running ads in the Meta Ad Library">
      <rect x={18} y={18} width={214} height={150} rx={14} fill={SOFTER} stroke={LINE} strokeWidth={1.6} />
      <path d="M 18 42 H 232" stroke={LINE} strokeWidth={1.2} opacity={0.5} />
      {[34, 46, 58].map((cx) => (
        <circle key={cx} cx={cx} cy={30} r={3.4} fill={LINE} opacity={0.6} />
      ))}
      <text x={78} y={34} fontSize={11} fontWeight={700} fill={LINE} opacity={0.85}>
        meta ad library
      </text>
      {([["home", 32], ["story", 96], ["price", 160]] as const).map(([icon, x], i) => (
        <g key={x}>
          <AdCard x={x} y={54} w={58} h={78} icon={icon} tint={i === 1 ? "rgb(200 242 106 / 0.32)" : SOFT} />
          <rect x={x + 6} y={138} width={46} height={14} rx={7} fill={i === 1 ? LIME : SOFT} />
          <text x={x + 29} y={148} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={i === 1 ? INK : LINE}>
            {["64 days", "121 days", "88 days"][i]}
          </text>
        </g>
      ))}
      <g className="cc-scan" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <circle cx={125} cy={92} r={30} fill="rgb(255 255 255 / 0.12)" stroke="#fff" strokeWidth={5} />
        <path d="M 147 114 L 178 146" stroke="#fff" strokeWidth={9} strokeLinecap="round" />
        <path d="M 112 78 Q 118 72 127 72" stroke="#fff" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.7} />
      </g>
      <Bot x={268} y={150} s={1.05} className="cc-bob" />
      <Sparkle x={150} y={64} s={0.9} className="cc-twinkle" style={d(300)} />
      <Sparkle x={258} y={70} s={0.7} className="cc-twinkle" style={d(900)} />
    </svg>
  );
}

const ANGLES: Icon[] = ["price", "noexam", "family", "home", "age", "story", "shield", "clock", "flower", "price", "family", "story"];
const TINTS = [SOFT, "rgb(200 242 106 / 0.3)", "rgb(255 138 92 / 0.32)", SOFT, "rgb(159 208 255 / 0.32)", "rgb(255 138 92 / 0.32)"];

/** 2. Twelve creatives, each on a different angle, popping out one after another. */
function Make() {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="Twelve ad cards, each with a different angle: price, no exam, family, home, age 50+, a client story, protection, time and final costs">
      {ANGLES.map((icon, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        return <AdCard key={i} x={14 + col * 49} y={26 + row * 82} w={42} h={70} icon={icon} tint={TINTS[(i + row) % TINTS.length]} className="cc-pop" style={d(i * 90)} />;
      })}
      <rect x={104} y={4} width={112} height={18} rx={9} fill={LIME} className="cc-pop" style={d(1150)} />
      <text x={160} y={17} textAnchor="middle" fontSize={11} fontWeight={800} fill={INK} className="cc-pop" style={d(1150)}>
        10–13 angles
      </text>
    </svg>
  );
}

const SCORES = [0.34, 0.92, 0.5, 0.78, 0.22];

/** 3. Meta's delivery watching them, bars growing under each; the strongest get a star. */
function Test() {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="Meta's delivery shows each ad to people; bars grow under every ad and the two strongest get a star">
      <g transform="translate(160 42)">
        <path d="M -26 0 Q 0 -20 26 0 Q 0 20 -26 0 Z" fill="#fff" />
        <circle r={8.5} fill={INK} />
        <circle r={3.5} fill={LIME} className="cc-blink" />
      </g>
      <text x={160} y={16} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={LINE} opacity={0.85}>
        meta&apos;s delivery tests every angle
      </text>
      {SCORES.map((s, i) => {
        const x = 22 + i * 58;
        const top = SCORES.slice().sort((a, b) => b - a).slice(0, 2).includes(s);
        return (
          <g key={i}>
            <path d={`M 160 56 L ${x + 21} 72`} stroke={LINE} strokeWidth={1.2} strokeDasharray="3 4" opacity={0.45} />
            <AdCard x={x} y={72} w={42} h={56} icon={ANGLES[i * 2]} tint={TINTS[i]} />
            <rect x={x + 8} y={136} width={26} height={60} rx={5} fill={SOFTER} />
            <rect
              x={x + 8}
              y={136 + 60 * (1 - s)}
              width={26}
              height={60 * s}
              rx={5}
              fill={top ? LIME : "rgb(255 255 255 / 0.55)"}
              className="cc-bar"
              style={d(300 + i * 140)}
            />
            {top && <Sparkle x={x + 21} y={126 + 60 * (1 - s)} s={0.9} className="cc-pop" style={d(1300 + i * 80)} />}
          </g>
        );
      })}
    </svg>
  );
}

/** 4. Weak ads pause; the winner sprouts new creatives for the next week. */
function Improve() {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="Weak ads are paused, and new ads are made from the winning one for the next week">
      {[0, 1, 2].map((i) => (
        <g key={i} className="cc-sink" style={d(200 + i * 160)}>
          <AdCard x={14 + (i % 2) * 34} y={30 + i * 56} w={38} h={50} icon={(["clock", "shield", "age"] as Icon[])[i]} dim />
          <circle cx={45 + (i % 2) * 34} cy={34 + i * 56} r={9} fill={ORANGE} />
          <path d={`M ${42 + (i % 2) * 34} ${30 + i * 56} v 8 M ${48 + (i % 2) * 34} ${30 + i * 56} v 8`} stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        </g>
      ))}
      <AdCard x={120} y={66} w={62} h={84} icon="story" tint="rgb(200 242 106 / 0.32)" glow className="cc-pulse" />
      <g transform="translate(151 52)">
        <path d="M -10 4 L -7 -6 L -2 0 L 0 -9 L 2 0 L 7 -6 L 10 4 Z" fill={LIME} />
      </g>
      {[0, 1, 2].map((i) => {
        const y = 22 + i * 60;
        return (
          <g key={i}>
            <path
              d={`M 186 108 C 214 108 210 ${y + 26} 238 ${y + 26}`}
              fill="none"
              stroke={LIME}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray="4 5"
              className="cc-flow"
              style={d(900 + i * 150)}
            />
            <AdCard x={242} y={y} w={42} h={54} icon={(["story", "family", "price"] as Icon[])[i]} tint={TINTS[(i + 1) % TINTS.length]} className="cc-pop" style={d(1200 + i * 180)} />
            <Sparkle x={290} y={y + 2} s={0.7} className="cc-twinkle" style={d(1500 + i * 180)} />
          </g>
        );
      })}
      <rect x={118} y={168} width={66} height={20} rx={10} fill={LIME} />
      <text x={151} y={182} textAnchor="middle" fontSize={11} fontWeight={800} fill={INK}>
        next week
      </text>
    </svg>
  );
}

const STEPS = [
  {
    art: <Study />,
    title: "it studies what's already winning.",
    body: "migz ai reads long-running life insurance ads from the meta ad library: the hooks, angles and formats that keep getting budget.",
  },
  {
    art: <Make />,
    title: "it makes 10 to 13 creatives.",
    body: "images and videos, each on a different angle: price, no exam, family, final costs, age, a client's story. no copies of anyone's ads.",
  },
  {
    art: <Test />,
    title: "meta's algorithm tests them.",
    body: "they all launch together, so meta's delivery can find which angles your audience actually responds to.",
  },
  {
    art: <Improve />,
    title: "weak ads pause. winners get new siblings.",
    body: "from week two, the ads that aren't pulling their weight are paused and new ones are made from what's winning, then again every couple of weeks.",
  },
];

export function CreativeCycle() {
  return (
    <div className="cc">
      <ol className="cc__steps">
        {STEPS.map((s, i) => (
          <li key={i} className="cc__step" data-reveal style={d(i * 110)}>
            <div className="cc__art">{s.art}</div>
            <p className="cc__num">{String(i + 1).padStart(2, "0")}</p>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="cc__loop" data-reveal>
        <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true" className="cc__loop-icon">
          <path d="M 32 20 A 12 12 0 1 1 26 9.6" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" />
          <path d="M 21 5 L 28 9 L 23.5 15.5" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>
          <b>then it keeps going.</b> the longer your campaign runs, the more migz ai knows about what books calls for you.
        </p>
      </div>
    </div>
  );
}
