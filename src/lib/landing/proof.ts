// The proof a landing page shows, read from agent_brand.proof. Everything is optional and nothing is invented:
// a block with no data is not shown to visitors (staff see a placeholder in preview).

export type Proof = {
  rating: number | null; // Google score, 1 to 5
  reviews: number | null; // Google review count
  reviewsUrl: string | null;
  badges: { name: string; rating: number | null; count: number | null }[]; // HomeStars, Yelp, BBB...
  stats: { value: string; label: string }[];
  ownerName: string | null;
  ownerVideo: string | null; // creatives bucket path
  ownerPoster: string | null;
  videos: { path: string; poster: string | null; name: string; area: string | null }[];
  logos: { path: string; name: string }[];
};

const s = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function parseProof(raw: unknown): Proof {
  const r = obj(raw);
  const url = s(r.reviewsUrl, 300);
  return {
    rating: n(r.rating, 1, 5),
    reviews: n(r.reviews, 1, 1_000_000),
    reviewsUrl: /^https:\/\//.test(url) ? url : null,
    badges: arr(r.badges)
      .map((b) => ({ name: s(obj(b).name, 40), rating: n(obj(b).rating, 1, 5), count: n(obj(b).count, 1, 1_000_000) }))
      .filter((b) => b.name)
      .slice(0, 4),
    stats: arr(r.stats)
      .map((x) => ({ value: s(obj(x).value, 16), label: s(obj(x).label, 60) }))
      .filter((x) => x.value && x.label)
      .slice(0, 4),
    ownerName: s(r.ownerName, 60) || null,
    ownerVideo: s(r.ownerVideo, 300) || null,
    ownerPoster: s(r.ownerPoster, 300) || null,
    videos: arr(r.videos)
      .map((v) => ({ path: s(obj(v).path, 300), poster: s(obj(v).poster, 300) || null, name: s(obj(v).name, 60), area: s(obj(v).area, 60) || null }))
      .filter((v) => v.path)
      .slice(0, 3),
    logos: arr(r.logos)
      .map((l) => ({ path: s(obj(l).path, 300), name: s(obj(l).name, 60) }))
      .filter((l) => l.path)
      .slice(0, 6),
  };
}
