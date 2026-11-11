// The HyperFrames composition for an edit plan: one 1080x1920 HTML page with a paused GSAP timeline, which the
// render worker turns into frames. Pure. Files it expects next to it (the worker puts them there):
//   talk.mp4 (cut and graded, silent here: the sound is mixed separately), broll0.mp4.., frame0.png,
//   logo.png (optional), fonts/heading-700.woff2, fonts/body-400.woff2, gsap.min.js
import type { Brand } from "@/lib/edit/brand";
import { FPS, H, W, type EditPlan } from "@/lib/edit/plan";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => Number(x.toFixed(3));
const EASE = "expo.out";

export type CompositionFiles = { headingWeights: number[]; bodyWeights: number[]; hasLogo: boolean; brollCount: number };

export function buildComposition(plan: EditPlan, brand: Brand, files: CompositionFiles) {
  const D = plan.seconds;
  const face = (family: string, prefix: string, weights: number[]) => weights.map((w) => `@font-face{font-family:"${prefix}";src:url(./fonts/${prefix}-${w}.woff2) format("woff2");font-weight:${w};font-display:block}`).join("");
  const headingWeight = Math.max(...(files.headingWeights.length ? files.headingWeights : [700]));
  const css = `
${face(brand.headingFont, "heading", files.headingWeights)}${face(brand.bodyFont, "body", files.bodyWeights)}
*{box-sizing:border-box;margin:0;padding:0}
body{margin:0;background:#000}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000;isolation:isolate}
.layer{position:absolute;inset:0}
#cam{transform-origin:${n(plan.eye.x)}px ${n(plan.eye.y)}px;will-change:transform}
#cam video,#cam img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#loopframe{visibility:hidden}
.broll{overflow:hidden;visibility:hidden}
.broll video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%}
.text{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};color:${brand.text};text-shadow:0 4px 18px rgba(0,0,0,.6),0 2px 4px rgba(0,0,0,.5)}
.hook{position:absolute;display:block;padding-top:20px;text-align:center;font-size:84px;line-height:1.05;letter-spacing:-.01em;text-transform:uppercase;text-wrap:balance;overflow-wrap:break-word}
.hook .accent{color:${brand.accent}}
.cap{position:absolute;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:0 .26em;text-align:center;font-size:76px;line-height:1.08;visibility:hidden}
.cap span{display:inline-block}
.card{position:absolute;visibility:hidden;display:flex;flex-direction:column;justify-content:center;gap:6px;border-radius:28px;background:${brand.background};color:${brand.text};padding:26px 40px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
.card .kicker{font-family:"body",system-ui,sans-serif;font-size:30px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${brand.accent}}
.card .main{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:58px;line-height:1.05}
.card .sub{font-family:"body",system-ui,sans-serif;font-size:30px;opacity:.85}
.card .bar{position:absolute;left:0;top:22px;bottom:22px;width:8px;border-radius:0 8px 8px 0;background:${brand.accent};transform-origin:50% 0}
.num{position:absolute;visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.num .big{font-size:150px;line-height:.95;letter-spacing:-.02em}
.num .big .accent{color:${brand.accent}}
.num .sub{font-family:"body",system-ui,sans-serif;font-weight:600;font-size:40px;margin-top:10px}
.cta{position:absolute;visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;border-radius:32px;background:${brand.background};color:${brand.text};padding:34px;box-shadow:0 24px 60px rgba(0,0,0,.4)}
.cta .logo{max-height:96px;max-width:70%;object-fit:contain}
.cta .main{font-family:"heading",system-ui,sans-serif;font-weight:${headingWeight};font-size:96px;line-height:1}
.cta .main .accent{color:${brand.accent}}
.cta .sub{font-family:"body",system-ui,sans-serif;font-weight:700;font-size:40px;opacity:.92}
`;
  const box = (b: { x: number; y: number; w: number; h: number }) => `left:${n(b.x)}px;top:${n(b.y)}px;width:${n(b.w)}px;height:${n(b.h)}px`;
  const hookHtml = (id: string) => {
    if (!plan.hook) return "";
    const t = esc(plan.hook.text);
    const accent = plan.hook.accent ? t.replace(new RegExp(esc(plan.hook.accent).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), (m) => `<span class="accent">${m}</span>`) : t;
    return `<div id="${id}" class="text hook" style="${box(plan.hook.box)}">${accent}</div>`;
  };
  const caps = plan.captions
    .map((c, i) => `<div id="cap${i}" class="text cap" style="${box(plan.captionBox)}">${c.words.map((w, k) => `<span id="cap${i}w${k}">${esc(w.word)}</span>`).join("")}</div>`)
    .join("\n");
  const kicker: Record<string, string> = { town: "Serving", cert: "Certified", license: "Licensed & insured", warranty: "Warranty" };
  const cards = plan.cards
    .map((c, i) => {
      if (c.kind === "cta")
        return `<div id="card${i}" class="cta" style="${box(c.box)}">${files.hasLogo ? `<img class="logo" src="./logo.png" alt="">` : ""}<div class="main">Tap <span class="accent">Learn More</span></div><div class="sub">${esc(c.sub ?? "")}</div></div>`;
      if (c.kind === "number")
        return `<div id="card${i}" class="text num" style="${box(c.box)}"><div class="big"><span class="accent">${esc(c.text)}</span></div>${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ""}</div>`;
      const sub = c.kind === "license" ? c.sub : c.kind === "cert" ? null : c.sub;
      const main = c.kind === "license" && c.text === "Licensed & insured" ? "Licensed & insured" : c.text;
      return `<div id="card${i}" class="card" style="${box(c.box)}"><div class="bar"></div><div class="kicker">${esc(c.kind === "license" && main === "Licensed & insured" ? "Licensed" : kicker[c.kind])}</div><div class="main">${esc(main)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
    })
    .join("\n");
  const broll = plan.broll
    .map((b) => `<div id="b${b.index}" class="layer broll" data-start="${n(b.start)}" data-duration="${n(b.end - b.start)}"><video id="bv${b.index}" src="./broll${b.index}.mp4" data-start="${n(b.start)}" data-duration="${n(b.end - b.start)}" data-media-start="0" muted playsinline></video></div>`)
    .join("\n");

  // The timeline: one ease (expo out), every change on its frame
  const tl: string[] = [];
  const set = (sel: string, vars: string, at: number) => tl.push(`tl.set("${sel}",{${vars}},${n(at)});`);
  const to = (sel: string, vars: string, at: number) => tl.push(`tl.to("${sel}",{${vars}},${n(at)});`);
  const fromTo = (sel: string, a: string, b: string, at: number) => tl.push(`tl.fromTo("${sel}",{${a}},{${b}},${n(at)});`);
  const scaleOf = (f: string) => (f === "close" ? plan.closeScale : 1);
  for (const f of plan.framings) set("#cam", `scale:${n(scaleOf(f.framing))}`, f.start);
  for (const p of plan.pushes) fromTo("#cam", `scale:${n(p.from)}`, `scale:${n(p.to)},duration:0.4,ease:"${EASE}",immediateRender:false`, p.start);
  if (plan.hook) {
    set("#hook", "autoAlpha:1", 0);
    to("#hook", `autoAlpha:0,duration:0.25,ease:"${EASE}"`, plan.hook.end);
  }
  plan.captions.forEach((c, i) => {
    fromTo(`#cap${i}`, "autoAlpha:0", `autoAlpha:1,duration:0.08,ease:"${EASE}",immediateRender:false`, c.start);
    set(`#cap${i}`, "autoAlpha:0", c.end);
    // The word being said in the accent colour
    c.words.forEach((w, k) => {
      set(`#cap${i}w${k}`, `color:"${brand.accent}"`, Math.max(w.start, c.start));
      const next = c.words[k + 1]?.start ?? c.end;
      if (next < c.end) set(`#cap${i}w${k}`, `color:"${brand.text}"`, next);
    });
  });
  plan.cards.forEach((c, i) => {
    const id = `#card${i}`;
    if (c.kind === "number") {
      fromTo(id, "autoAlpha:0,scale:0.86,y:40", `autoAlpha:1,scale:1,y:0,duration:0.45,ease:"${EASE}",immediateRender:false`, c.start);
      to(id, `autoAlpha:0,duration:0.18,ease:"${EASE}"`, c.end - 0.18);
    } else if (c.kind === "cta") {
      fromTo(id, "autoAlpha:0,y:60,scale:0.96", `autoAlpha:1,y:0,scale:1,duration:0.5,ease:"${EASE}",immediateRender:false`, c.start);
      set(id, "autoAlpha:0", plan.loopFrom);
    } else {
      fromTo(id, "autoAlpha:0,x:-60", `autoAlpha:1,x:0,duration:0.4,ease:"${EASE}",immediateRender:false`, c.start);
      fromTo(`${id} .bar`, "scaleY:0", `scaleY:1,duration:0.5,ease:"${EASE}",immediateRender:false`, c.start + 0.05);
      to(id, `autoAlpha:0,x:-30,duration:0.2,ease:"${EASE}"`, c.end - 0.2);
    }
  });
  plan.broll.forEach((b) => {
    set(`#b${b.index}`, "autoAlpha:1", b.start);
    fromTo(`#bv${b.index}`, "scale:1.0", `scale:1.07,duration:${n(b.end - b.start)},ease:"none",immediateRender:false`, b.start);
    set(`#b${b.index}`, "autoAlpha:0", b.end);
  });
  // The loop: the last frames are frame 0 again (the first frame, the first framing, the hook back on)
  set("#cam", `scale:${n(scaleOf(plan.framings[0].framing))}`, plan.loopFrom);
  set("#loopframe", "autoAlpha:1", plan.loopFrom);
  if (plan.hook) set("#hook", "autoAlpha:1", plan.loopFrom);
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
<div id="cam" class="layer" style="transform:scale(${n(scaleOf(plan.framings[0].framing))})">
<video id="talk" src="./talk.mp4" data-start="0" data-duration="${n(D)}" data-media-start="0" muted playsinline data-track-index="0"></video>
<img id="loopframe" src="./frame0.png" alt="">
</div>
${broll}
${hookHtml("hook")}
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
