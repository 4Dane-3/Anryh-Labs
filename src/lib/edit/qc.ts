// The checks every edit passes before it renders (the plan) and after (the file). Pure.
import { SAFE, overlaps, scaleAt, scaleBox, type Box, type EditPlan } from "@/lib/edit/plan";
import type { Word } from "@/lib/edit/words";

export type Check = { name: string; pass: boolean; detail: string };

const frames = (plan: EditPlan, s: number) => Math.round(Math.abs(s) * plan.fps);
const inSafe = (b: Box) => b.x >= SAFE.left && b.y >= SAFE.top && b.x + b.w <= SAFE.right && b.y + b.h <= SAFE.bottom;
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The largest the face gets between two moments (zooms included), or null when no face was found. */
function faceBetween(plan: EditPlan, face: Box | null, from: number, to: number) {
  if (!face) return null;
  let s = 1;
  for (let t = from; t <= to; t += 1 / plan.fps) s = Math.max(s, scaleAt(plan, t));
  return scaleBox(face, plan.eye, s);
}

/** Plan checks 1-5, plus no stacked effects and the pacing. */
export function checkPlan(plan: EditPlan, opts: { face: Box | null; names: string[]; sourceWords: Word[] }): Check[] {
  const out: Check[] = [];
  const shadow = 12; // text shadows reach this far past the box

  // 1. Sync: each effect starts within 2 frames of its word
  const late = plan.effects.filter((e) => frames(plan, e.start - e.anchor) > 2);
  const onWord = (t: number) => t === 0 || plan.words.some((w) => frames(plan, w.start - t) <= 2);
  const floating = [...plan.cards, ...plan.broll].filter((c) => !onWord(c.start));
  out.push({ name: "Sync", pass: !late.length && !floating.length, detail: late.length || floating.length ? `${late.length + floating.length} effects miss their word by more than 2 frames` : `${plan.effects.length} effects, all within 2 frames of their word` });

  // 2. Faces: no text or card over the face, at its biggest while each is on screen
  const boxes: { label: string; box: Box; from: number; to: number }[] = [
    ...(plan.hook ? [{ label: "hook", box: plan.hook.box, from: 0, to: plan.hook.end }] : []),
    ...(plan.hook ? [{ label: "hook (loop)", box: plan.hook.box, from: plan.loopFrom, to: plan.seconds }] : []),
    ...plan.captions.map((c) => ({ label: `caption "${c.words.map((w) => w.word).join(" ")}"`, box: plan.captionBox, from: c.start, to: c.end })),
    ...plan.cards.map((c) => ({ label: `${c.kind} card`, box: c.box, from: c.start, to: c.end })),
  ];
  const overFace = boxes.filter((b) => {
    const f = faceBetween(plan, opts.face, b.from, b.to);
    // Not over the face while a job clip covers the talking video
    const covered = plan.broll.some((r) => b.from >= r.start && b.to <= r.end);
    return f && !covered && overlaps({ x: b.box.x - shadow, y: b.box.y - shadow, w: b.box.w + shadow * 2, h: b.box.h + shadow * 2 }, f);
  });
  out.push({ name: "Faces", pass: !overFace.length, detail: overFace.length ? `Over the face: ${overFace.map((b) => b.label).slice(0, 3).join(", ")}` : opts.face ? "No text or graphic over the face" : "No face found in the frame (nothing to cover)" });

  // 3. Safe zone
  const outside = boxes.filter((b) => !inSafe(b.box));
  out.push({ name: "Safe zone", pass: !outside.length, detail: outside.length ? `Outside: ${outside.map((b) => b.label).slice(0, 3).join(", ")}` : "Everything inside the safe zone" });

  // 4. Cuts: every kept word is whole inside a kept stretch
  const clipped = opts.sourceWords.filter((w) => plan.segments.some((s) => w.start < s.to && w.end > s.from && (w.start < s.from - 0.005 || w.end > s.to + 0.005)));
  out.push({ name: "Cuts", pass: !clipped.length, detail: clipped.length ? `Cut mid-word: ${clipped.map((w) => w.word).slice(0, 3).join(", ")}` : `${plan.segments.length - 1} cuts, none mid-word` });

  // 5. Names spelled as given: a near miss left in the captions is a fail
  const shownWords = [...plan.captions.flatMap((c) => c.words.map((w) => w.word)), ...plan.cards.map((c) => c.text)];
  const misses: string[] = [];
  for (const n of opts.names.filter((x) => letters(x).length >= 4)) {
    for (const w of shownWords) {
      const a = letters(w);
      if (!a || a === letters(n) || n.split(/\s+/).some((p) => letters(p) === a)) continue;
      if (a.length >= 5 && n.split(/\s+/).some((p) => letters(p).length >= 5 && near(a, letters(p)))) misses.push(`${w} (${n})`);
    }
  }
  out.push({ name: "Captions", pass: !misses.length, detail: misses.length ? `Misspelled: ${[...new Set(misses)].slice(0, 3).join(", ")}` : "Every name and brand spelled as given" });

  // No two effects on the same beat
  const starts = plan.effects.map((e) => e.start).sort((a, b) => a - b);
  const stacked = starts.filter((t, i) => i && t - starts[i - 1] < 0.29);
  out.push({ name: "One at a time", pass: !stacked.length, detail: stacked.length ? `${stacked.length} effects stacked on the same beat` : "No two effects on the same beat" });

  // Pacing: a change every 1.5s in the opening, never 4s without one (job clips and the last card count as change)
  const changes = [...new Set([0, ...starts])].sort((a, b) => a - b);
  const gaps: string[] = [];
  changes.forEach((t, i) => {
    const next = changes[i + 1] ?? plan.loopFrom;
    const covered = plan.broll.some((b) => t >= b.start - 0.01 && next <= b.end + 0.01) || plan.cards.some((c) => c.kind === "cta" && t >= c.start - 0.01);
    if (covered) return;
    if (t < 3 && Math.min(next, 3) - t > 1.55) gaps.push(`${t.toFixed(1)}s`);
    else if (next - t > 4.05) gaps.push(`${t.toFixed(1)}s`);
  });
  out.push({ name: "Pacing", pass: !gaps.length, detail: gaps.length ? `Nothing changes for too long after ${gaps.slice(0, 3).join(", ")}` : "Something changes every 1.5s in the opening and at least every 4s after" });

  // 7. Loop: the closing frames are frame 0 (same framing, the hook back on)
  const loopOk = plan.framings[0]?.start === 0 && plan.loopFrom < plan.seconds && (!plan.hook || plan.hook.box.y >= SAFE.top);
  out.push({ name: "Loop", pass: loopOk, detail: loopOk ? "Ends on frame 0" : "The ending doesn't return to frame 0" });
  return out;
}

function near(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let diff = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length; i++, j++) {
    if (a[i] !== b[j]) {
      diff++;
      if (a[i + 1] === b[j]) i++;
      else if (a[i] === b[j + 1]) j++;
    }
    if (diff > 2) return false;
  }
  return diff > 0;
}

export type RenderStats = { lufs: number | null; truePeak: number | null; blackFrames: number; frozenSeconds: number; loopMatch: number | null; seconds: number | null; width: number | null; height: number | null };

/** Render checks 6-8 on the finished file (measured by the worker with ffmpeg). */
export function checkRender(s: RenderStats): Check[] {
  return [
    { name: "Audio", pass: s.lufs !== null && Math.abs(s.lufs + 14) <= 1 && s.truePeak !== null && s.truePeak <= -0.9, detail: `${s.lufs?.toFixed(1) ?? "?"} LUFS, peak ${s.truePeak?.toFixed(1) ?? "?"} dBTP (target -14, at most -1)` },
    { name: "Loop frame", pass: s.loopMatch !== null && s.loopMatch >= 0.985, detail: `Last frame matches frame 0: ${s.loopMatch === null ? "?" : `${(s.loopMatch * 100).toFixed(1)}%`}` },
    { name: "Picture", pass: s.blackFrames === 0 && s.frozenSeconds < 1.5, detail: `${s.blackFrames} black frames, ${s.frozenSeconds.toFixed(1)}s frozen` },
    { name: "Format", pass: s.width === 1080 && s.height === 1920 && (s.seconds ?? 0) > 5, detail: `${s.width}x${s.height}, ${s.seconds?.toFixed(1) ?? "?"}s` },
  ];
}

/**
 * Builds the plan and fixes what it can: a hook over the face moves down to the caption band, a card over the face
 * or outside the safe zone is dropped (the words still say it). Returns the plan and its checks.
 */
export function fixPlan(plan: EditPlan, opts: { face: Box | null; names: string[]; sourceWords: Word[] }): { plan: EditPlan; checks: Check[] } {
  let p = plan;
  for (let round = 0; round < 3; round++) {
    const checks = checkPlan(p, opts);
    if (checks.every((c) => c.pass)) return { plan: p, checks };
    const bad = (b: Box, from: number, to: number) => {
      const f = faceBetween(p, opts.face, from, to);
      return !inSafe(b) || (!!f && overlaps(b, f));
    };
    let hook = p.hook;
    if (hook && bad(hook.box, 0, hook.end)) hook = { ...hook, box: { ...hook.box, y: p.captionBox.y } };
    const cards = p.cards.filter((c) => c.kind === "cta" || !bad(c.box, c.start, c.end));
    const dropped = new Set(p.cards.filter((c) => !cards.includes(c)).map((c) => c.start));
    p = { ...p, hook, cards, effects: p.effects.filter((e) => !(e.kind === "card" && dropped.has(e.start))) };
    if (!dropped.size && hook === p.hook && round > 0) return { plan: p, checks: checkPlan(p, opts) };
  }
  return { plan: p, checks: checkPlan(p, opts) };
}
