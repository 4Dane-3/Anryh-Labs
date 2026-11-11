import type { CreativeBrief } from "@/lib/migz/brief";

// Reading a model's revised brief back: no I/O.

export function textOf(content: { type: string; text?: string }[]) {
  return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

export function parseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model didn't return JSON");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

/** Keeps the original's structure and system fields, taking only the words and shots the model may change. */
export function mergeRevision(original: CreativeBrief, r: Record<string, unknown>): CreativeBrief {
  const str = (k: keyof CreativeBrief) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim() : (original[k] as string));
  const merged: CreativeBrief = { ...original, concept: str("concept"), style: str("style"), hook_line: str("hook_line"), hook_shot: str("hook_shot"), primary_text: str("primary_text"), headline: str("headline") };
  if (original.voiceover && typeof r.voiceover === "string" && r.voiceover.trim()) merged.voiceover = r.voiceover.trim();
  const shots = r.body_shots as CreativeBrief["body_shots"] | undefined;
  if (Array.isArray(shots) && shots.length === original.body_shots.length && shots.every((s, i) => typeof s?.prompt === "string" && s.prompt.trim() && original.body_shots[i]))
    merged.body_shots = shots.map((s, i) => ({ prompt: s.prompt.trim(), duration: original.body_shots[i].duration }));
  const said = r.presenter as { script?: unknown; callout?: unknown } | undefined;
  if (original.presenter && typeof said?.script === "string" && said.script.trim()) merged.presenter = { ...(merged.presenter ?? original.presenter), script: said.script.trim() };
  if (original.presenter && typeof said?.callout === "string" && said.callout.trim())
    merged.presenter = { ...(merged.presenter ?? original.presenter), callout: said.callout.trim().split(/\s+/).slice(0, 4).join(" ") };
  return merged;
}
