// The roofer's own photos and clips, by what they show, and which ones go into a video. Pure: the setup form,
// the job that makes the video and the edit plan all use it. Real clips cut in as they are (free, and they look
// real); real photos get a slow camera move from Higgsfield first. The edit cuts to the clip that matches the
// word being said: "inspection" cuts to someone inspecting, "leak" to damage, "crew" to the crew at work.

export const MEDIA_KINDS = [
  { key: "crew", label: "Crew working on a roof", hint: "Tear-offs, laying shingles, on the ladder" },
  { key: "inspection", label: "Inspections", hint: "Someone on a roof or in an attic, checking, taking photos" },
  { key: "damage", label: "Damage you've found", hint: "Leaks, moss, missing or curling shingles, stains" },
  { key: "finished", label: "Finished roofs", hint: "Close-ups and the whole house after" },
  { key: "drone", label: "Drone or aerial", hint: "Over a job or the neighborhood" },
  { key: "team", label: "Your team and trucks", hint: "The crew together, branded trucks, the shop" },
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number]["key"];
export type JobMedia = { path: string; kind: MediaKind | "other"; type: "photo" | "video" };

export const MAX_JOB_MEDIA = 30;
/** Cut-aways in one video: up to three photos (each a paid Higgsfield clip), a fourth when it's a real clip. */
export const MAX_BROLL = 4;
const MAX_PHOTO_BROLL = 3;

export const isMediaKind = (k: unknown): k is MediaKind => MEDIA_KINDS.some((m) => m.key === k);

/** Their media, with the job photos uploaded before kinds existed counted as "other". */
export function allMedia(media: JobMedia[] | null | undefined, legacyPhotos: string[] | null | undefined): JobMedia[] {
  const known = new Set((media ?? []).map((m) => m.path));
  return [...(media ?? []), ...(legacyPhotos ?? []).filter((p) => !known.has(p)).map((path) => ({ path, kind: "other" as const, type: "photo" as const }))];
}

/** What a video's cut-aways show: one of each kind first (a real clip before a photo), different picks from one
 * video to the next (`seed`), at most three photos. */
export function pickBroll(media: JobMedia[], seed = 0): JobMedia[] {
  const order: (MediaKind | "other")[] = ["crew", "inspection", "damage", "drone", "finished", "team", "other"];
  const byKind = order
    .map((k) => {
      const of = media.filter((m) => m.kind === k);
      const videos = of.filter((m) => m.type === "video");
      const photos = of.filter((m) => m.type === "photo");
      const rot = <T,>(xs: T[]) => (xs.length ? [...xs.slice(seed % xs.length), ...xs.slice(0, seed % xs.length)] : xs);
      return [...rot(videos), ...rot(photos)];
    })
    .filter((xs) => xs.length);
  const out: JobMedia[] = [];
  let photos = 0;
  for (let round = 0; out.length < MAX_BROLL && byKind.some((xs) => xs.length > round); round++) {
    for (const xs of byKind) {
      const m = xs[round];
      if (!m || out.length >= MAX_BROLL) continue;
      if (m.type === "photo" && photos >= MAX_PHOTO_BROLL) continue;
      if (m.type === "photo") photos++;
      out.push(m);
    }
  }
  return out;
}

const WORD_KINDS: [RegExp, MediaKind[]][] = [
  [/^(inspect|inspection|inspections|inspected|inspecting|check|checked|checking|look|looked|photos?|attic)$/, ["inspection", "damage"]],
  [/^(leaks?|leaking|moss|granules?|curling|stains?|storms?|wind|hail|damage|damaged|missing|rot|rotting|ceiling|winter|rain|flashing|old)$/, ["damage", "inspection"]],
  [/^(crew|crews|install|installed|installing|replace|replaced|replacement|replacing|shingles?|tear|tearoff|work|working|build|built)$/, ["crew", "finished"]],
  [/^(new|finished|done|warranty|warranties|guarantee|beautiful|years?)$/, ["finished", "drone"]],
  [/^(roofs?|homes?|houses?|neighborhood|neighbors?|area|town)$/, ["drone", "finished"]],
  [/^(team|family|local|owned|we|us|our)$/, ["team", "crew"]],
];

/** The kinds of clip that fit a spoken word, best first (empty: no particular kind). */
export function kindsForWord(word: string): MediaKind[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  return WORD_KINDS.find(([re]) => re.test(w))?.[1] ?? [];
}

/** The camera move Higgsfield gives a photo of this kind: real motion that adds nothing to the scene. */
export function motionFor(kind: JobMedia["kind"]) {
  const base = "Nothing is added, removed or changed; no people appear or vanish; no text.";
  if (kind === "crew") return `Slow handheld push toward the crew; they keep working with small natural movements. ${base}`;
  if (kind === "inspection") return `Slow handheld push in on the person inspecting the roof; small natural movement. ${base}`;
  if (kind === "drone") return `Slow, smooth drone glide forward and slightly down over the house. ${base}`;
  if (kind === "damage") return `Slow close push in across the damaged shingles, like a phone camera moving in. ${base}`;
  if (kind === "team") return `Slow gentle push in on the team and trucks; small natural movement. ${base}`;
  return `Slow, smooth drone-style push across this real roofing job. ${base}`;
}
