// Emojis that pop next to a caption word: a pin on a town, an ear on "listen", a star on reviews. One per caption
// at most, never two within EMOJI_GAP seconds, so they punctuate the edit instead of cluttering it.

export const EMOJI_GAP = 1.8;

const RULES: [RegExp, string][] = [
  [/^(listen|listening|hear|heard|hearing)$/, "👂"],
  [/^(tell|told|say|said|talk|talking|ask|asked)$/, "🗣️"],
  [/^(reviews?|fivestar|5star|stars?|rated|google)$/, "⭐"],
  [/^(free)$/, "🎁"],
  [/^(off|save|savings|deal|discount|percent|\d+%)$/, "💸"],
  [/^(hair|hairline|hairlines|grafts?|transplants?)$/, "💇‍♂️"],
  [/^(surgeon|surgeons|doctor|dr|clinic|medical)$/, "👨‍⚕️"],
  [/^(consultation|consult|consults|questions?)$/, "💬"],
  [/^(book|booking|today|month|friday|monday|week|weekend|appointment)$/, "📅"],
  [/^(call|phone|text)$/, "📞"],
  [/^(patients|customers|clients|homeowners|families)$/, "🙌"],
  [/^(salesman|salesmen|pushy|pressure)$/, "🙅"],
  [/^(trust|word|promise|honest)$/, "🤝"],
  [/^(warranty|guarantee|guaranteed|insured|licensed)$/, "🛡️"],
  [/^(roof|roofs|roofing|home|house)$/, "🏠"],
  [/^(storm|storms|rain|leaks?|leaking)$/, "🌧️"],
  [/^(years?|decades?)$/, "⏳"],
  [/^(fast|quick|quickly|minutes)$/, "⚡"],
  [/^(face|smile|confidence|confident)$/, "😁"],
];

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");

/** The emoji for a word, or null. Towns (any the client serves) get a pin. */
export function emojiFor(word: string, towns: string[] = []): string | null {
  const w = clean(word);
  if (!w) return null;
  if (towns.some((t) => clean(t) === w)) return "📍";
  return RULES.find(([re]) => re.test(w))?.[1] ?? null;
}

/** For each caption, at most one emoji (on its first word that has one), spaced EMOJI_GAP apart. */
export function pickEmojis(captions: { words: { word: string; start: number }[] }[], towns: string[] = []) {
  let last = -99;
  return captions.map((c) => {
    for (const [k, w] of c.words.entries()) {
      const char = emojiFor(w.word, towns);
      if (char && w.start - last >= EMOJI_GAP) {
        last = w.start;
        return { word: k, char };
      }
    }
    return null;
  });
}
