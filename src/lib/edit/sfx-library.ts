// Our own sound-effects library: a folder of clicks, dings, swooshes and so on, sorted into the edit's sound kinds
// by filename, so a pack can be dropped in as it comes ("Whoosh Soft 03.wav", "UI Pop 2.mp3", "bell-ding.wav").
// Several files of one kind take turns through an edit (the 1st whoosh, then the 2nd...), so it never sounds like
// the same sample on repeat. Pure: the local test, the upload script and the tests share it.
import type { SfxKind } from "@/lib/edit/plan";

export const SFX_KINDS: SfxKind[] = ["hit", "click", "whoosh", "pop", "swoosh", "riser", "ding"];

export const SFX_EXTENSIONS = /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg)$/i;

// Checked in order: the first kind whose words appear in the name wins ("swoosh" is checked before "whoosh"'s
// looser words, "riser" before "hit" so "riser into impact" is a riser).
const RULES: [SfxKind, RegExp][] = [
  ["riser", /riser|rise|build[\s_-]?up|uplifter|sweep[\s_-]?up|reverse/],
  ["ding", /ding|bell|chime|notif|sparkle|twinkle|success|correct|coin/],
  ["swoosh", /swoosh|swish|transition|swipe|slide/],
  ["whoosh", /whoosh|woosh|zoom|wind|air|fly[\s_-]?by|pass[\s_-]?by/],
  // A "swing" is a card or image sliding in, which is when we play a pop
  ["pop", /pop|bubble|blip|bloop|plop|ui[\s_-]?appear|appear|swing/],
  ["click", /click|clack|tap|tick|shutter|mouse|snap|keyboard|type/],
  ["hit", /hit|impact|boom|thud|bass[\s_-]?drop|punch|slam|stomp|braam|drop/],
];

/** The sound kind a file is, from its name (or the folder it's in), or null when nothing matches. */
export function sfxKindOf(path: string): SfxKind | null {
  if (!SFX_EXTENSIONS.test(path)) return null;
  // The file's own name first; then its folder ("Swooshes/03.wav")
  const parts = path.toLowerCase().split(/[\\/]/).reverse();
  for (const part of parts) {
    const name = part.replace(SFX_EXTENSIONS, "");
    for (const [kind, re] of RULES) if (re.test(name)) return kind;
  }
  return null;
}

/** Files sorted into kinds (each kind's files in name order, so the rotation is stable), plus what didn't match. */
export function sortSfx(paths: string[]): { byKind: Partial<Record<SfxKind, string[]>>; unmatched: string[] } {
  const byKind: Partial<Record<SfxKind, string[]>> = {};
  const unmatched: string[] = [];
  for (const p of [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!SFX_EXTENSIONS.test(p)) continue;
    const kind = sfxKindOf(p);
    if (kind) (byKind[kind] ??= []).push(p);
    else unmatched.push(p);
  }
  return { byKind, unmatched };
}

/** Which of a kind's files plays at its nth use in the edit (0-based): they take turns. */
/** A kind a library lacks borrows a close one's files (a swoosh is a whoosh; a hit a riser's landing is not). */
export const SFX_STAND_INS: [SfxKind, SfxKind][] = [
  ["swoosh", "whoosh"],
  ["whoosh", "swoosh"],
  ["pop", "click"],
];

export const sfxVariant = <T>(files: T[], nth: number): T => files[nth % files.length];
