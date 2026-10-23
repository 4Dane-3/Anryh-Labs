// Migz creative briefs: what Higgsfield renders and the ad copy around it. Briefs are stored on the
// creative (creatives.script).
// - Video: hook shot + body shots. A winning video's body can be reused with a new hook (same body
//   shots, new first shot), which is how Migz tests hooks.
// - Image: a lifestyle photo with 1-3 short lines of text (and an optional button) laid out on it.
// - Carousel: 2 square cards people swipe through, each a photo with its own text and headline.

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
  // The short-film standard (briefs made before it don't have these):
  cast?: string; // the same people in every shot, e.g. "a woman in her late 30s and her two kids, about 6 and 9"
  setting?: string; // one real place the story stays in, e.g. "a real suburban home with a sunlit kitchen"
  mood?: string; // the emotional arc and what never appears, e.g. "grief turning into gratitude; hopeful, never dark"
  voiceover?: string | null; // off-screen narration over the footage (nobody on screen speaks)
  narrator?: "female" | "male"; // whose voice reads it (ElevenLabs; see narration.ts)
};

export type ImageBrief = {
  format: "image";
  concept: string;
  topic?: string;
  scene: string; // who is in the photo, where, doing what, and the light
  style: string; // photographic look
  overlay_lines: string[]; // 1-3 short lines rendered on the image, e.g. "Protect their peace."
  button_text: string | null; // a button-shaped label, e.g. "Book a free call"
  aspect_ratio: "4:5" | "9:16" | "1:1"; // 4:5 for feeds, 9:16 for Stories and Reels, 1:1 for carousel cards
  primary_text: string;
  headline: string;
};

export type CarouselCard = {
  scene: string; // the photo on this card
  overlay_lines: string[]; // 1-2 short lines on the card
  headline: string; // the card's headline under the image
};

export type CarouselBrief = {
  format: "carousel";
  concept: string;
  topic?: string;
  style: string; // one photographic look across both cards
  cards: CarouselCard[]; // exactly CAROUSEL_CARDS, in swipe order
  primary_text: string;
  headline: string; // the first card's headline (copy checks and labels use it)
};

export type AnyBrief = CreativeBrief | ImageBrief | CarouselBrief;

export const CAROUSEL_CARDS = 2;
export const MAX_CARD_LINES = 2;

export const HOOK_SECONDS = 3;
export const MAX_VIDEO_SECONDS = 15;
export const MAX_OVERLAY_LINES = 3;

// Every still carries its message on the image (1-3 short lines): an ad with no words on it gives the
// viewer nothing to stop for, so 9:16 Stories/Reels images get text too.
export const MAX_OVERLAY_LINE_CHARS = 40;
export const MAX_BUTTON_CHARS = 24;

export const isImageBrief = (brief: AnyBrief): brief is ImageBrief => brief.format === "image";
export const isCarouselBrief = (brief: AnyBrief): brief is CarouselBrief => brief.format === "carousel";
// Briefs stored before images existed have no format: they're videos
export const isVideoBrief = (brief: AnyBrief): brief is CreativeBrief => !brief.format || brief.format === "video";

/** One carousel card as a square still, made like a feed image (text on the photo, no button). */
export function cardBrief(brief: CarouselBrief, i: number): ImageBrief {
  const card = brief.cards[i];
  return {
    format: "image",
    concept: brief.concept,
    ...(brief.topic ? { topic: brief.topic } : {}),
    scene: card.scene,
    style: brief.style,
    overlay_lines: card.overlay_lines,
    button_text: null,
    aspect_ratio: "1:1",
    primary_text: brief.primary_text,
    headline: card.headline,
  };
}

export function briefDuration(brief: CreativeBrief) {
  return HOOK_SECONDS + brief.body_shots.reduce((s, b) => s + b.duration, 0);
}

/**
 * Added to every video, whatever the brief says. Video models fill gaps with uncanny behaviour (forced
 * laughing, people staring at each other or the lens, mouths moving); this spells out natural behaviour.
 */
export const VIDEO_REALISM =
  "Natural, candid behaviour: people are absorbed in what they're doing, with small genuine smiles and real emotion. No exaggerated or forced laughing, no one looks into the camera, no long stares or eye contact held between people, no talking or lip movement. Realistic faces, hands and body proportions; slow, smooth, unhurried motion.";
const SHOT_REALISM = "Candid and natural, small genuine smiles, nobody looks at the camera, no talking.";

/**
 * Story continuity, also added to every video. A model left alone will plant a sapling in one shot and show
 * it fully grown in the next while the family hasn't aged a day.
 */
export const VIDEO_CONTINUITY =
  "Continuity: time moves forward only where a shot says so (e.g. 'years later'), and then everything ages together: the people look visibly older, children have grown, trees and gardens have grown. Otherwise nothing changes between shots: the same people with the same faces, age, hair and clothes, the same season and place, and every object stays as it was left (a sapling stays a sapling).";
const SHOT_CONTINUITY = "Same people, same age and clothes as the other shots unless this shot says time has passed.";

// Narration for a 15-second video: about 2.5 words a second, so it fits without rushing
export const MAX_VOICEOVER_WORDS = 40;

/** A shot that jumps forward in time but never says how anyone aged (the planted-tree-grows problem). */
export function timeJumpWithoutAging(shot: string) {
  const jumps = /\b(years?|decades?|months?|seasons?)\s+(later|pass|go by|have passed|on)\b|\b(fully|now)\s+grown\b|\btime\s+(passes|skip)/i.test(shot);
  if (!jumps) return false;
  // Word stems on purpose: "teen" covers teenager, "graduat" covers graduation
  const aged = /\b(older|aged|ageing|aging|grown[- ]up|teen|graduat|adult|grey|gray|wrinkl|retire|grandchild|grandkid|grandparent|\d{1,2}[- ]year[- ]old|in (?:his|her|their) (?:\d0s|twenties|thirties|forties|fifties|sixties|seventies))/i.test(shot);
  return !aged;
}

/** Shot timings in seconds: the hook, then each body shot in order. */
function shotTimings(brief: CreativeBrief) {
  const lengths = [HOOK_SECONDS, ...brief.body_shots.map((b) => b.duration)];
  let t = 0;
  return lengths.map((len) => {
    const from = t;
    t += len;
    return { from, to: t, len };
  });
}

/**
 * The whole-video prompt, written like a short-film brief: what it's about, the look and the place, the
 * same cast throughout, timed shots, the mood, and the realism rules.
 */
export function videoPrompt(brief: CreativeBrief) {
  const times = shotTimings(brief);
  const shots = [brief.hook_shot, ...brief.body_shots.map((b) => b.prompt)];
  return [
    `A ${times.at(-1)!.to}-second vertical short film about ${clean(brief.concept)}. ${clean(brief.style)}${brief.setting ? `, ${clean(brief.setting)}` : ""}. No text, no logos, no captions.`,
    brief.cast ? `The same people appear throughout: ${clean(brief.cast)}.` : "",
    ...shots.map((shot, i) => `Shot ${i + 1} (${times[i].from}–${times[i].to}s): ${clean(shot)}`),
    brief.mood ? `Mood: ${clean(brief.mood)}` : "",
    VIDEO_CONTINUITY,
    brief.voiceover
      ? `Voiceover: an off-screen narrator with a warm, calm, natural voice says: "${clean(brief.voiceover)}" The narration plays over the footage; no one on screen speaks or moves their lips.`
      : "No narration and no dialogue: natural ambient sound only.",
    VIDEO_REALISM,
  ]
    .filter(Boolean)
    .join("\n");
}

/** One prompt per shot (each capped at 512 characters by the model): the action, the same cast, the look. */
export function shotPrompts(brief: CreativeBrief) {
  const times = shotTimings(brief);
  const shots = [brief.hook_shot, ...brief.body_shots.map((b) => b.prompt)];
  const cast = brief.cast ? ` Same people: ${clean(brief.cast).slice(0, 140)}.` : "";
  return shots.map((shot, i) => {
    const tail = `${cast} ${clean(brief.style)}. ${SHOT_REALISM} ${SHOT_CONTINUITY}`;
    return { prompt: `${clean(shot).slice(0, 512 - tail.length - 2)}.${tail}`.slice(0, 512), duration: times[i].len };
  });
}

/** Short label for a brief: the hook for videos, the first text line for images and carousels. */
export function briefLabel(brief: AnyBrief) {
  const first = isImageBrief(brief) ? brief.overlay_lines[0] : isCarouselBrief(brief) ? brief.cards[0]?.overlay_lines[0] : brief.hook_line;
  return first || brief.concept || "New creative";
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
    `A ${clean(brief.style)} photo for a life insurance ad, ${brief.aspect_ratio === "1:1" ? "1:1 square" : `${brief.aspect_ratio} vertical`}. ${clean(brief.scene)}`,
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
