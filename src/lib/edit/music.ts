// Background music moods a client picks for their videos. Each mood is one instrumental made once with
// ElevenLabs Music and kept at creatives/system/music-library/<mood>/, so every video in that mood reuses it.
// The render worker loops it under the voice, ducks it while they talk and fades it on the last word.

export const MUSIC_MOODS = {
  soft: {
    label: "Soft",
    hint: "Warm piano and pads. Calm and reassuring.",
    prompt: "Soft, warm, reassuring instrumental bed for a medical clinic video: gentle felt piano, airy pads and a light pulse. Calm, modern, premium. Even level throughout, no big swells. Slow tempo. No vocals, no lyrics, no drums.",
  },
  upbeat: {
    label: "Upbeat",
    hint: "Light drums and bright guitar. Positive and moving.",
    prompt: "Upbeat, positive, modern instrumental bed for a social ad: tight light drums, warm bass, bright plucked guitar and claps. Confident and fun, not cheesy. Steady energy throughout. No vocals, no lyrics.",
  },
  educational: {
    label: "Educational",
    hint: "Plucks and soft beat. Curious, sits under talking.",
    prompt: "Curious, clean instrumental bed for an educational explainer video: soft marimba and pizzicato plucks, a gentle lo-fi beat and light synth. Thoughtful and clear, sits under a voice. Steady level. No vocals, no lyrics.",
  },
  inspiring: {
    label: "Inspiring",
    hint: "Building piano and strings. Hopeful.",
    prompt: "Inspiring, hopeful cinematic instrumental bed: steady piano ostinato with soft strings and a gentle kick that builds slowly. Emotional but restrained, sits under a voice. No vocals, no lyrics.",
  },
  luxury: {
    label: "Luxury",
    hint: "Smooth, slow and polished. High-end.",
    prompt: "Smooth, polished, high-end instrumental bed for a luxury aesthetics brand: deep warm bass, soft Rhodes chords, brushed minimal beat and silky pads. Slow, elegant and confident. No vocals, no lyrics.",
  },
} as const;

export type MusicMood = keyof typeof MUSIC_MOODS;
export const MUSIC_MOOD_KEYS = Object.keys(MUSIC_MOODS) as MusicMood[];
export const DEFAULT_MUSIC_MOOD: MusicMood = "soft";
export const MUSIC_LIBRARY = "system/music-library";

/** A stored mood, or the default for anything unknown (old rows, typos). "none" means no music. */
export function musicMood(v: string | null | undefined): MusicMood | "none" {
  if (v === "none") return "none";
  return v && v in MUSIC_MOODS ? (v as MusicMood) : DEFAULT_MUSIC_MOOD;
}
