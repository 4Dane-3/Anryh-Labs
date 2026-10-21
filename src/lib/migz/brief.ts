// Migz creative briefs: what Higgsfield renders and the ad copy around it. Briefs are stored on the
// creative (creatives.script).
// - Video: hook shot + body shots. A winning video's body can be reused with a new hook (same body
//   shots, new first shot), which is how Migz tests hooks.
// - Image: a lifestyle photo with 1-3 short lines of text (and an optional button) laid out on it.

export type CreativeBrief = {
  format?: "video"; // briefs stored before image ads existed have no format: they're videos
  concept: string; // one line: the angle, e.g. "Mortgage protection for new homeowners"
  topic?: string; // which advertising topic it serves (topics.ts), when Migz made it
  style: string; // visual direction applied to every shot
  hook_line: string; // the opening idea in words (also leads the primary text)
  hook_shot: string; // prompt for the first ~3 seconds
  body_shots: { prompt: string; duration: number }[];
  primary_text: string;
  headline: string;
};

export type ImageBrief = {
  format: "image";
  concept: string;
  topic?: string;
  scene: string; // who is in the photo, where, doing what, and the light
  style: string; // photographic look
  overlay_lines: string[]; // 1-3 short lines rendered on the image, e.g. "Protect their peace."
  button_text: string | null; // a button-shaped label, e.g. "Book a free call"
  aspect_ratio: "4:5" | "9:16"; // 4:5 for feeds, 9:16 for Stories and Reels
  primary_text: string;
  headline: string;
};

export type AnyBrief = CreativeBrief | ImageBrief;

export const HOOK_SECONDS = 3;
export const MAX_VIDEO_SECONDS = 15;
export const MAX_OVERLAY_LINES = 3;
export const MAX_OVERLAY_LINE_CHARS = 40;
export const MAX_BUTTON_CHARS = 24;

export const isImageBrief = (brief: AnyBrief): brief is ImageBrief => brief.format === "image";

export function briefDuration(brief: CreativeBrief) {
  return HOOK_SECONDS + brief.body_shots.reduce((s, b) => s + b.duration, 0);
}

/** Short label for a brief: the hook for videos, the first text line for images. */
export function briefLabel(brief: AnyBrief) {
  return (isImageBrief(brief) ? brief.overlay_lines[0] : brief.hook_line) || brief.concept || "New creative";
}

// Quotes inside the text would break the prompt's "exactly as written" quoting
const clean = (s: string) => s.replace(/["“”]/g, "").trim();

/**
 * The image prompt: one consistent layout so every Migz image ad reads well on a phone. People in
 * the lower two-thirds, text in the open space above, and an explicit spelling instruction (text
 * rendering is where image models slip).
 */
export function imagePrompt(brief: ImageBrief) {
  const lines = brief.overlay_lines.map(clean).filter(Boolean);
  const tall = brief.aspect_ratio === "9:16";
  const button = brief.button_text ? clean(brief.button_text) : null;

  return [
    `A ${clean(brief.style)} photo for a life insurance ad, ${brief.aspect_ratio} vertical. ${clean(brief.scene)}`,
    "Genuine, candid expressions, unposed. The people fill the lower two-thirds of the frame; the upper third is open, softly blurred background, leaving clean space for text.",
    "",
    `In the upper third, centered, ${lines.length === 1 ? "one short line" : `${lines.length} short lines`} of clean, modern serif text in warm white with a subtle soft shadow for readability${lines.length > 1 ? ", stacked with even spacing" : ""}:`,
    ...lines.map((l) => `"${l}"`),
    lines.length > 1 ? "The last line is slightly bolder." : "",
    button
      ? `\n${tall ? "About 80% of the way down" : "At the bottom"}, a small rounded button shape in warm off-white with dark text reading "${button}".`
      : "",
    "",
    "Spell every word exactly as written. No other text, no logos, no watermarks, no extra words.",
  ]
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n")
    .trim();
}
