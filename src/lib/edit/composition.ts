// The HyperFrames composition for an edit plan: one 1080x1920 HTML page with a paused GSAP timeline, which the
// render worker turns into frames. Pure. The look follows docs/migz-video-edit.md: a moody graded shot of the owner
// at the job, and text on the torso (never the face) in two weights: small light lead words, then the stressed
// words big, bold and glowing in the brand accent. Map-pin town tags, a name tag with focus brackets, an offer
// pill, glass credential cards and a glowing "Tap Learn More" card.
// Files it expects next to it (the worker puts them there):
//   talk.mp4 (cut and graded, silent here: the sound is mixed separately), broll0.mp4.., frame0.png,
//   logo.png (optional), fonts/heading-{w}.woff2, fonts/body-{w}.woff2, gsap.min.js
import type { Brand } from "@/lib/edit/brand";
import { FPS, H, W, fitBox, scaleAt, scaleBox, type Box, type EditPlan } from "@/lib/edit/plan";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => Number(x.toFixed(3));
const EASE = "expo.out";

export type CompositionFiles = { headingWeights: number[]; bodyWeights: number[]; hasLogo: boolean; brollCount: number };

/** "#F59E0B" -> "245,158,11", for glows. */
function rgb(hex: string) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0).join(",");
}

/** A caption split into its light lead words and its stressed words (the end of the phrase). Pure. */
export function splitCaption(words: string[]) {
  if (words.length <= 1) return { lead: [] as string[], punch: words };
  let from = words.length - (words.length === 2 ? 1 : Math.ceil(words.length / 2));
  // The stressed words never start on a little word ("us take" -> "take")
  const little = (w: string) => /^(a|an|the|to|of|for|us|we|i|i'm|it|is|are|and|or|in|on|at|my|our|your|you)$/i.test(w.replace(/[^a-z']/gi, ""));
  while (from < words.length - 1 && little(words[from])) from++;
  return { lead: words.slice(0, from), punch: words.slice(from) };
}

/** The stressed line's size: as big as fits on one line (two at most), never under 72px. */
export function punchSize(text: string) {
  return Math.max(72, Math.min(116, Math.floor(860 / Math.max(1, text.length * 0.6))));
}

const PIN = `<svg class="pin" viewBox="0 0 40 64" width="40" height="64"><defs><radialGradient id="pg" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#ff8a8a"/><stop offset=".45" stop-color="#e5232b"/><stop offset="1" stop-color="#8f0f14"/></radialGradient></defs><line x1="20" y1="30" x2="20" y2="62" stroke="#c9ccd1" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="18" r="16" fill="url(#pg)"/><ellipse cx="14" cy="12" rx="5" ry="3.5" fill="#fff" opacity=".55"/></svg>`;
const SHIELD = `<svg viewBox="0 0 48 48" width="56" height="56"><path d="M24 4 40 10v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" fill="none" stroke="#111" stroke-width="3.5" stroke-linejoin="round"/><path d="m16 24 6 6 11-12" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = (accent: string) => `<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="10" fill="none" stroke="${accent}" stroke-width="2"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BADGE = (accent: string) => `<svg viewBox="0 0 64 72" width="96" height="108"><path d="M32 3 59 15v20c0 17-12 29-27 34C17 64 5 52 5 35V15z" fill="${accent}"/><path d="M32 11 51 19v16c0 12-8 21-19 25-11-4-19-13-19-25V19z" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2"/><path d="m21 36 8 8 15-17" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW = (accent: string) => `<svg viewBox="0 0 24 24" width="64" height="64"><path d="M12 4v15m0 0-6-6m6 6 6-6" fill="none" stroke="${accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LOC = `<svg viewBox="0 0 24 24" width="22" height="22" style="vertical-align:-3px;margin-right:6px"><path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="rgba(255,255,255,.7)"/></svg>`;

export function buildComposition(plan: EditPlan, brand: Brand, files: CompositionFiles) {
  const D = plan.seconds;
  const A = brand.accent;
  const AR = rgb(A);
  const face = (prefix: string, weights: number[]) => weights.map((w) => `@font-face{font-family:"${prefix}";src:url(./fonts/${prefix}-${w}.woff2) format("woff2");font-weight:${w};font-display:block}`).join("");
  const headingWeight = Math.max(...(files.headingWeights.length ? files.headingWeights : [700]));
  const light = files.bodyWeights.includes(300) ? 300 : 400;
  const company = plan.company ?? "";
  const place = plan.area ?? "";
  const kickerLine = [company, place].filter(Boolean).join(" · ").toUpperCase();

  const css = `
${face("heading", files.headingWeights)}${face("body", files.bodyWeights)}
*{box-sizing:border-box;margin:0;padding:0}
body{margin:0;background:#000}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000;isolation:isolate;font-family:"body",system-ui,sans-serif;color:#fff}
.layer{position:absolute;inset:0}
#cam{transform-origin:${n(plan.eye.x)}px ${n(plan.eye.y)}px;will-change:transform}
#cam video,#cam img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#loopframe{visibility:hidden}
#bg{overflow:hidden;transform:scale(1.15);filter:blur(42px) brightness(.45) saturate(1.1)}
#bg video,#bg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#bgloop{visibility:hidden}
${plan.fit ? `#fit{transform-origin:${n(plan.fit.origin.x)}px ${n(plan.fit.origin.y)}px;transform:scale(${n(plan.fit.scale)});overflow:hidden;border-radius:${n(40 / plan.fit.scale)}px;box-shadow:0 30px 80px rgba(0,0,0,.45)}` : ""}
#vignette{pointer-events:none;background:radial-gradient(ellipse 85% 70% at 50% 42%,rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%),linear-gradient(to bottom,rgba(0,0,0,.25),rgba(0,0,0,0) 22%,rgba(0,0,0,0) 62%,rgba(0,0,0,.35))}
.broll{overflow:hidden;visibility:hidden}
.broll video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%}
.bwrap{overflow:hidden}
.shadow{text-shadow:0 3px 14px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.45)}
.glow{color:${A};text-shadow:0 0 18px rgba(${AR},.55),0 0 42px rgba(${AR},.35),0 3px 10px rgba(0,0,0,.5)}
.glass{background:linear-gradient(115deg,rgba(18,18,20,.78),rgba(18,18,20,.6));backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 60px rgba(0,0,0,.45)}
.cap{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;visibility:hidden}
.cap .lead{font-family:"body",system-ui,sans-serif;font-weight:${light};font-size:58px;line-height:1.05;margin-right:96px}
.cap .punch{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};line-height:.95;letter-spacing:-.02em;margin-left:72px}
.cap .lead,.cap .punch{display:block;will-change:transform,filter,opacity}
.hook{position:absolute;display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding-left:40px;visibility:hidden}
.hook .lead{font-family:"body",system-ui,sans-serif;font-weight:${light};font-size:52px;letter-spacing:.02em;text-transform:lowercase;margin-left:8px}
.hookbig{position:absolute;display:block;text-align:center;font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:84px;line-height:1.02;text-transform:uppercase;text-wrap:balance;visibility:hidden}
.tag{display:flex;align-items:center;gap:6px;visibility:hidden}
.tag .pill{border-radius:22px;padding:10px 30px 12px 24px;font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:56px;line-height:1}
.tag .pin{margin-top:-30px;filter:drop-shadow(0 6px 8px rgba(0,0,0,.5))}
.card{position:absolute;visibility:hidden}
.namewrap{display:flex;justify-content:center}
.namecard{display:flex;align-items:center;gap:22px;border-radius:26px;padding:22px 30px;max-width:860px}
.namecard .who{display:flex;flex-direction:column}
.namecard .role{font-size:24px;font-weight:700;color:${A};letter-spacing:.04em}
.namecard .name{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:76px;line-height:.95}
.namecard .bar{width:3px;align-self:stretch;background:rgba(255,255,255,.35);border-radius:3px}
.namecard .co{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:54px;line-height:1}
.namecard .co b{color:${A};font-weight:inherit}
.namecard .loc{font-size:24px;color:rgba(255,255,255,.7);margin-top:6px}
.focus{position:absolute;visibility:hidden}
.focus i{position:absolute;width:30%;height:30%;border-color:${A};border-style:solid;border-width:0;filter:drop-shadow(0 0 8px rgba(${AR},.8))}
.focus i:nth-child(1){left:0;top:0;border-left-width:7px;border-top-width:7px}
.focus i:nth-child(2){right:0;top:0;border-right-width:7px;border-top-width:7px}
.focus i:nth-child(3){left:0;bottom:0;border-left-width:7px;border-bottom-width:7px}
.focus i:nth-child(4){right:0;bottom:0;border-right-width:7px;border-bottom-width:7px}
.offer{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:14px}
.offer .lead{font-family:"body",system-ui,sans-serif;font-weight:${light};font-size:56px;line-height:1}
.offer .pillbig{background:${A};color:#16110a;border-radius:999px;padding:18px 52px 22px;font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:96px;line-height:1;letter-spacing:-.01em;box-shadow:0 0 40px rgba(${AR},.6),0 0 90px rgba(${AR},.3),0 14px 30px rgba(0,0,0,.45)}
.cred{display:flex;align-items:center;gap:24px;border-radius:30px;padding:30px 34px;background:linear-gradient(110deg,rgba(14,14,16,.86) 45%,rgba(${AR},.38))}
.cred .txt{flex:1;display:flex;flex-direction:column;gap:6px}
.kicker{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.9)}
.kicker:before{content:"";width:10px;height:10px;border-radius:50%;background:${A};box-shadow:0 0 10px ${A}}
.cred .main{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:62px;line-height:1}
.cred .checks{display:flex;gap:22px;margin-top:6px;font-size:28px;font-weight:600}
.cred .checks span{display:flex;align-items:center;gap:8px}
.pledge{display:flex;align-items:center;gap:24px;border-radius:28px;padding:24px 30px}
.pledge .icon{flex:none;width:92px;height:92px;border-radius:50%;background:${A};display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(${AR},.55)}
.pledge .k{font-size:22px;font-weight:700;letter-spacing:.06em;color:${A}}
.pledge .main{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:50px;line-height:1.02}
.cta{display:flex;flex-direction:column;gap:12px;border-radius:34px;padding:30px 34px;background:linear-gradient(120deg,rgba(28,24,22,.72),rgba(${AR},.22))}
.cta .k{align-self:flex-start;border:1.5px solid rgba(255,255,255,.4);border-radius:999px;padding:6px 18px;font-size:22px;font-weight:700;letter-spacing:.05em}
.cta .row{display:flex;align-items:center;justify-content:space-between;gap:20px}
.cta .main{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:74px;line-height:1;white-space:nowrap}
.cta .sub{font-size:34px;font-weight:700;line-height:1.15}
.cta .deal{font-size:30px;font-weight:600;color:${A};margin-top:4px}
.cta .ring{flex:none;width:112px;height:112px;border-radius:50%;border:5px solid ${A};display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(${AR},.7),inset 0 0 20px rgba(${AR},.35)}
.cta .logo{max-height:70px;max-width:260px;object-fit:contain;align-self:flex-start}
`;
  const box = (b: Box) => `left:${n(b.x)}px;top:${n(b.y)}px;width:${n(b.w)}px;height:${n(b.h)}px`;
  const at = (b: Box) => `left:${n(b.x)}px;top:${n(b.y)}px;width:${n(b.w)}px`;
  const accentLast = (s: string) => {
    const parts = esc(s).split(" ");
    return parts.length > 1 ? `${parts[0]} <b>${parts.slice(1).join(" ")}</b>` : `<b>${parts[0]}</b>`;
  };

  // The hook: map-pin town tags under a light line, or (no towns) big text
  let hookHtml = "";
  if (plan.hook?.pins?.length) {
    const rest = plan.hook.pins.reduce((t, town) => t.replace(new RegExp(town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), ""), plan.hook.text).replace(/[,\s]+/g, " ").trim();
    hookHtml = `<div id="hook" class="hook" style="${box(plan.hook.box)}">${rest ? `<div id="hooklead" class="lead shadow">${esc(rest)}</div>` : ""}${plan.hook.pins.map((t, i) => `<div id="tag${i}" class="tag" style="margin-left:${i * 46}px">${PIN}<div class="pill glass">${esc(t)}</div></div>`).join("")}</div>`;
  } else if (plan.hook) {
    const t = esc(plan.hook.text);
    const accent = plan.hook.accent ? t.replace(new RegExp(esc(plan.hook.accent).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), (m) => `<span class="glow">${m}</span>`) : t;
    hookHtml = `<div id="hook" class="hookbig shadow" style="${box(plan.hook.box)}">${accent}</div>`;
  }

  const caps = plan.captions
    .map((c, i) => {
      const { lead, punch } = splitCaption(c.words.map((w) => w.word));
      const p = punch.join(" ");
      return `<div id="cap${i}" class="cap" style="${box(plan.captionBox)}">${lead.length ? `<span id="cap${i}l" class="lead shadow">${esc(lead.join(" "))}</span>` : ""}<span id="cap${i}p" class="punch glow" style="font-size:${punchSize(p)}px">${esc(p)}</span></div>`;
    })
    .join("\n");

  const kickerDiv = kickerLine ? `<div class="kicker">${esc(kickerLine)}</div>` : "";
  const cards = plan.cards
    .map((c, i) => {
      const id = `card${i}`;
      if (c.kind === "cta") {
        const deal = c.sub && c.sub.toLowerCase() !== plan.offer.toLowerCase() ? c.sub : null;
        return `<div id="${id}" class="card cta glass" style="${at(c.box)}">${files.hasLogo ? `<img class="logo" src="./logo.png" alt="">` : kickerLine ? `<div class="k">${esc(kickerLine)}</div>` : ""}<div class="row"><div><div class="main shadow">Tap <span class="glow">Learn More</span></div><div class="sub">to request your ${esc(plan.offer)}</div>${deal ? `<div class="deal">${esc(deal)}</div>` : ""}</div><div id="${id}ring" class="ring">${ARROW(A)}</div></div></div>`;
      }
      if (c.kind === "number") return `<div id="${id}" class="card offer" style="${box(c.box)}">${c.sub ? `<div class="lead shadow">${esc(c.sub)}</div>` : ""}<div id="${id}pill" class="pillbig">${esc(c.text)}</div></div>`;
      if (c.kind === "name")
        return `<div id="${id}" class="card namewrap" style="${at(c.box)}"><div class="namecard glass"><div class="who">${c.sub ? `<div class="role">${esc(c.sub)}</div>` : ""}<div class="name">${esc(c.text)}</div></div>${company ? `<div class="bar"></div><div><div class="co">${accentLast(company)}</div>${place ? `<div class="loc">${LOC}${esc(place)}</div>` : ""}</div>` : ""}</div></div>`;
      if (c.kind === "cert") return `<div id="${id}" class="card cred glass" style="${at(c.box)}"><div class="txt">${kickerDiv}<div class="main">${esc(c.text)}</div><div class="checks"><span>${CHECK(A)}Certified</span></div></div>${BADGE(A)}</div>`;
      if (c.kind === "town") return `<div id="${id}" class="card" style="${at(c.box)}"><div class="tag" style="visibility:inherit">${PIN}<div class="pill glass">${esc(c.text)}</div></div></div>`;
      const k = c.kind === "warranty" ? `${company ? `${company} · ` : ""}Warranty` : "Licensed";
      const main = c.kind === "license" ? (c.sub ? `Licensed · ${c.sub}` : c.text) : c.text;
      return `<div id="${id}" class="card pledge glass" style="${at(c.box)}"><div class="icon">${SHIELD}</div><div><div class="k">${esc(k.toUpperCase())}</div><div class="main">${esc(main)}</div></div></div>`;
    })
    .join("\n");

  // Focus brackets around the face while the name tag is up (at the size the zoom makes it then)
  const focusHtml = plan.cards
    .map((c, i) => {
      if (c.kind !== "name" || !plan.face) return "";
      const f = fitBox(scaleBox(plan.face, plan.eye, scaleAt(plan, c.start)), plan.fit);
      const pad = 18;
      return `<div id="focus${i}" class="focus" style="${box({ x: f.x - pad, y: f.y - pad, w: f.w + pad * 2, h: Math.min(f.h, f.w * 1.15) + pad * 2 })}"><i></i><i></i><i></i><i></i></div>`;
    })
    .join("");

  const broll = plan.broll
    .map((b) => `<div id="b${b.index}" class="layer broll" data-start="${n(b.start)}" data-duration="${n(b.end - b.start)}"><div id="bw${b.index}" class="layer bwrap"><video id="bv${b.index}" src="./broll${b.index}.mp4" data-start="${n(b.start)}" data-duration="${n(b.end - b.start)}" data-media-start="0" muted playsinline></video></div></div>`)
    .join("\n");

  // The timeline: one ease (expo out), every change on its frame
  const tl: string[] = [];
  const set = (sel: string, vars: string, t: number) => tl.push(`tl.set("${sel}",{${vars}},${n(t)});`);
  const to = (sel: string, vars: string, t: number) => tl.push(`tl.to("${sel}",{${vars}},${n(t)});`);
  const fromTo = (sel: string, a: string, b: string, t: number) => tl.push(`tl.fromTo("${sel}",{${a}},{${b}},${n(t)});`);
  const scaleOf = (f: string) => (f === "close" ? plan.closeScale : 1);
  const blur = (px: number) => `filter:"blur(${px}px)"`;
  for (const f of plan.framings) set("#cam", `scale:${n(scaleOf(f.framing))}`, f.start);
  for (const p of plan.pushes) fromTo("#cam", `scale:${n(p.from)}`, `scale:${n(p.to)},duration:0.4,ease:"${EASE}",immediateRender:false`, p.start);

  // Hook: the first tag is there on frame 0 (the loop returns to it); the rest drop in one after another
  if (plan.hook?.pins?.length) {
    set("#hook", "autoAlpha:1", 0);
    set("#tag0", `autoAlpha:1,x:0,${blur(0)}`, 0);
    plan.hook.pins.forEach((_, i) => {
      if (i > 0) fromTo(`#tag${i}`, `autoAlpha:0,x:-50,${blur(10)}`, `autoAlpha:1,x:0,${blur(0)},duration:0.35,ease:"${EASE}",immediateRender:false`, Math.max(0.1, Math.min(0.35 * i, plan.hook!.end - 0.4)));
    });
    to("#hook", `autoAlpha:0,y:-20,${blur(12)},duration:0.25,ease:"${EASE}"`, plan.hook.end);
  } else if (plan.hook) {
    set("#hook", "autoAlpha:1", 0);
    to("#hook", `autoAlpha:0,duration:0.25,ease:"${EASE}"`, plan.hook.end);
  }

  // Captions: the light lead words slide in, the stressed words punch in on their own word, then both blur away
  plan.captions.forEach((c, i) => {
    const { lead } = splitCaption(c.words.map((w) => w.word));
    const punchAt = Math.max(c.start, c.words[lead.length]?.start ?? c.start);
    set(`#cap${i}`, "autoAlpha:1", c.start);
    if (lead.length) fromTo(`#cap${i}l`, `autoAlpha:0,y:18,${blur(8)}`, `autoAlpha:1,y:0,${blur(0)},duration:0.25,ease:"${EASE}",immediateRender:false`, c.start);
    fromTo(`#cap${i}p`, `autoAlpha:0,scale:1.22,${blur(12)}`, `autoAlpha:1,scale:1,${blur(0)},duration:0.32,ease:"${EASE}",immediateRender:false`, punchAt);
    to(`#cap${i}`, `autoAlpha:0,y:-16,${blur(10)},duration:0.16,ease:"${EASE}"`, Math.max(c.start + 0.2, c.end - 0.06));
  });

  plan.cards.forEach((c, i) => {
    const id = `#card${i}`;
    if (c.kind === "cta") {
      fromTo(id, `autoAlpha:0,y:50,scale:0.94,${blur(14)}`, `autoAlpha:1,y:0,scale:1,${blur(0)},duration:0.45,ease:"${EASE}",immediateRender:false`, c.start);
      const bobs = Math.max(1, Math.floor((plan.loopFrom - c.start - 0.3) / 0.5) - 1);
      fromTo(`${id}ring`, "y:-6", `y:6,duration:0.5,ease:"sine.inOut",repeat:${bobs},yoyo:true,immediateRender:false`, c.start + 0.3);
      set(id, "autoAlpha:0", plan.loopFrom);
    } else if (c.kind === "number") {
      fromTo(id, "autoAlpha:0", `autoAlpha:1,duration:0.2,ease:"${EASE}",immediateRender:false`, c.start);
      fromTo(`${id}pill`, `scale:0.7,${blur(12)}`, `scale:1,${blur(0)},duration:0.4,ease:"${EASE}",immediateRender:false`, c.start);
      to(id, `autoAlpha:0,${blur(10)},duration:0.18,ease:"${EASE}"`, c.end - 0.18);
    } else {
      const from = c.kind === "name" ? "y:30" : "x:-60";
      fromTo(id, `autoAlpha:0,${from},${blur(12)}`, `autoAlpha:1,x:0,y:0,${blur(0)},duration:0.4,ease:"${EASE}",immediateRender:false`, c.start);
      to(id, `autoAlpha:0,${blur(10)},duration:0.2,ease:"${EASE}"`, c.end - 0.2);
      if (c.kind === "name" && plan.face) {
        fromTo(`#focus${i}`, "autoAlpha:0,scale:1.35", `autoAlpha:1,scale:1,duration:0.35,ease:"${EASE}",immediateRender:false`, c.start);
        to(`#focus${i}`, `autoAlpha:0,duration:0.2,ease:"${EASE}"`, c.end - 0.2);
      }
    }
  });

  // Cut-aways: in and out through a blur, with a slow push
  // (the clip element HyperFrames shows and hides is only switched on and off; the motion is on a wrapper inside it)
  plan.broll.forEach((b) => {
    set(`#b${b.index}`, "autoAlpha:1", b.start);
    fromTo(`#bw${b.index}`, `opacity:0,${blur(24)},scale:1.06`, `opacity:1,${blur(0)},scale:1,duration:0.28,ease:"${EASE}",immediateRender:false`, b.start);
    fromTo(`#bv${b.index}`, "scale:1.0", `scale:1.08,duration:${n(b.end - b.start)},ease:"none",immediateRender:false`, b.start);
    to(`#bw${b.index}`, `opacity:0,${blur(24)},duration:0.22,ease:"${EASE}"`, b.end - 0.22);
    set(`#b${b.index}`, "autoAlpha:0", b.end);
  });

  // The loop: the last frames are frame 0 again (the first frame, the first framing, the hook as on frame 0)
  set("#cam", `scale:${n(scaleOf(plan.framings[0].framing))}`, plan.loopFrom);
  set("#loopframe", "autoAlpha:1", plan.loopFrom);
  if (plan.fit) set("#bgloop", "autoAlpha:1", plan.loopFrom);
  if (plan.hook?.pins?.length) {
    set("#hook", `autoAlpha:1,y:0,${blur(0)}`, plan.loopFrom);
    plan.hook.pins.forEach((_, i) => set(`#tag${i}`, i === 0 ? `autoAlpha:1,x:0,${blur(0)}` : "autoAlpha:0", plan.loopFrom));
  } else if (plan.hook) set("#hook", "autoAlpha:1", plan.loopFrom);
  set("#root", "opacity:1", D - 1 / FPS); // pins the timeline's length to the video's

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
<script src="./gsap.min.js"></script>
<style>${css}</style>
</head>
<body>
<div id="root" data-composition-id="ad" data-start="0" data-duration="${n(D)}" data-width="${W}" data-height="${H}">
${plan.fit ? `<div id="bg" class="layer"><video id="bgv" src="./talk.mp4" data-start="0" data-duration="${n(D)}" data-media-start="0" muted playsinline data-track-index="1"></video><img id="bgloop" src="./frame0.png" alt=""></div>\n<div id="fit" class="layer">` : ""}
<div id="cam" class="layer" style="transform:scale(${n(scaleOf(plan.framings[0].framing))})">
<video id="talk" src="./talk.mp4" data-start="0" data-duration="${n(D)}" data-media-start="0" muted playsinline data-track-index="0"></video>
<img id="loopframe" src="./frame0.png" alt="">
</div>
${plan.fit ? "</div>" : ""}
${broll}
<div id="vignette" class="layer"></div>
${focusHtml}
${hookHtml}
${caps}
${cards}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${tl.join("\n")}
window.__timelines.ad = tl;
</script>
</body>
</html>
`;
}
