import "server-only";

// The voices a client can pick for their ads: ElevenLabs' own default voices and the whole public Voice Library
// (English), each with a preview clip. Library voices are spoken by id straight from the library: they don't
// take one of the account's custom-voice slots (only cloned voices do). Voices we recommend are starred and listed
// first; a voice without a preview clip isn't listed (nobody picks a voice they can't hear).

const API = "https://api.elevenlabs.io";

export type AdVoice = {
  id: string;
  name: string; // "Lyan"
  tagline: string | null; // "Female Genuine Casual Ads"
  gender: string | null;
  age: string | null;
  accent: string | null;
  description: string | null;
  preview: string; // ElevenLabs' public preview clip (played through /api/dashboard/voice-preview)
  source: "default" | "library";
  starred: boolean;
};

export type VoiceFilter = { gender?: "male" | "female" | null; search?: string | null; page?: number };

/** Our picks, starred and listed first: id, and the name to find a library voice by when it isn't on the first page. */
export const STARRED_VOICES: { id: string; name: string }[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { id: "Hd8mWkf5kvyBZB0S7yXU", name: "Ron - Older American Story Teller" },
  { id: "dXtC3XhB9GtPusIpNtQx", name: "Hale - Smooth, Confident and Persuasive" },
  { id: "qCwgiN0GsIAYwAJ1nYvZ", name: "Kirt - Podcast Host" },
  { id: "XN5MUfNpmfCV6rvigVhs", name: "Giselle Marie - Positive and Engaging" },
  { id: "lXyLz3Gu0YqdG8RfvIyZ", name: "John - Energetic, Unstoppable and Upbeat" },
];
const STARRED = new Set(STARRED_VOICES.map((v) => v.id));

const PAGE = 24;
const key = () => process.env.ELEVENLABS_API_KEY ?? "";
export const isVoiceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{16,32}$/.test(v);

/** Only ElevenLabs' own preview clips are ever fetched: their public files, or the preview endpoint some voices use. */
export function isPreviewUrl(u: string) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "storage.googleapis.com") return url.pathname.startsWith("/eleven-public-") && url.pathname.endsWith(".mp3");
    return /^api(\.[a-z]{2})?\.elevenlabs\.io$/.test(url.hostname) && /^\/v1\/voices\/[A-Za-z0-9]+\/previews\/audio$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Headers for fetching a preview: ElevenLabs' own API host gets the key, a public file gets nothing. */
export const previewHeaders = (u: string): Record<string, string> => (new URL(u).hostname.endsWith("elevenlabs.io") && key() ? { "xi-api-key": key() } : {});

function split(full: string) {
  const [name, ...rest] = full.split(/\s+-\s+/);
  return { name: name.trim(), tagline: rest.join(" - ").trim() || null };
}

type Raw = { voice_id: string; name: string; gender?: string; age?: string; accent?: string; description?: string | null; descriptive?: string; preview_url?: string | null; labels?: Record<string, string> };

function adVoice(v: Raw, source: AdVoice["source"]): AdVoice | null {
  if (!v.preview_url || !isPreviewUrl(v.preview_url)) return null;
  const { name, tagline } = split(v.name);
  return {
    id: v.voice_id,
    name,
    tagline: tagline ?? v.descriptive ?? v.labels?.descriptive ?? null,
    gender: v.gender ?? v.labels?.gender ?? null,
    age: (v.age ?? v.labels?.age ?? null)?.replace(/_/g, " ") ?? null,
    accent: v.accent ?? v.labels?.accent ?? null,
    description: v.description?.slice(0, 220) ?? null,
    preview: v.preview_url,
    source,
    starred: STARRED.has(v.voice_id),
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "xi-api-key": key() }, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  return (await res.json()) as T;
}

const defaultVoices = () => get<{ voices: Raw[] }>("/v2/voices?page_size=100&voice_type=default").then((d) => d.voices, () => [] as Raw[]);

/** A library voice by id, found through its name (the library can't be read by id). */
async function libraryVoice(v: { id: string; name: string }) {
  const found = await get<{ voices: Raw[] }>(`/v1/shared-voices?page_size=10&search=${encodeURIComponent(v.name)}`).catch(() => ({ voices: [] as Raw[] }));
  return found.voices.find((r) => r.voice_id === v.id) ?? null;
}

const matches = (v: AdVoice, f: VoiceFilter, search: string | null) =>
  (!f.gender || v.gender === f.gender) && (!search || `${v.name} ${v.tagline} ${v.description}`.toLowerCase().includes(search.toLowerCase()));

/** Starred voices, then ElevenLabs' own voices, then the library's most used English voices for ads. */
export async function findVoices(f: VoiceFilter = {}): Promise<{ voices: AdVoice[]; more: boolean }> {
  if (!key()) return { voices: [], more: false };
  const page = Math.max(0, f.page ?? 0);
  const search = f.search?.trim().slice(0, 60) || null;
  const q = new URLSearchParams({ page_size: String(PAGE), page: String(page), language: "en", sort: "usage_character_count_1y" });
  if (f.gender) q.set("gender", f.gender);
  if (search) q.set("search", search);
  else q.set("use_cases", "advertisement");
  const [defaults, library] = await Promise.all([page === 0 ? defaultVoices() : Promise.resolve([] as Raw[]), get<{ voices: Raw[]; has_more: boolean }>(`/v1/shared-voices?${q}`)]);
  const listed = [...defaults.map((v) => adVoice(v, "default")), ...library.voices.map((v) => adVoice(v, "library"))].filter((v): v is AdVoice => !!v);

  // On the first page with no search, every starred voice is there even if the library ranks it lower today
  if (page === 0 && !search) {
    const have = new Set(listed.map((v) => v.id));
    const missing = STARRED_VOICES.filter((s) => !have.has(s.id));
    const found = await Promise.all(missing.map((s) => libraryVoice(s)));
    for (const r of found) {
      const v = r && adVoice(r, "library");
      if (v) listed.push(v);
    }
  }

  const seen = new Set<string>();
  const voices = listed
    .filter((v) => matches(v, f, search) && !seen.has(v.id) && seen.add(v.id))
    .sort((a, b) => Number(b.starred) - Number(a.starred) || (a.starred && b.starred ? STARRED_VOICES.findIndex((s) => s.id === a.id) - STARRED_VOICES.findIndex((s) => s.id === b.id) : 0));
  return { voices, more: library.has_more };
}

/** The preview clip for a voice by id, when the page didn't send it (null when there's none). */
export async function previewUrl(id: string): Promise<string | null> {
  const own = (await defaultVoices()).find((v) => v.voice_id === id);
  if (own?.preview_url) return own.preview_url;
  const starred = STARRED_VOICES.find((s) => s.id === id);
  const lib = starred ? await libraryVoice(starred) : null;
  return lib?.preview_url ?? null;
}

/** Deletes a cloned voice from the account (frees its slot). Never throws. */
export async function deleteVoice(id: string) {
  if (!key() || !isVoiceId(id)) return;
  await fetch(`${API}/v1/voices/${id}`, { method: "DELETE", headers: { "xi-api-key": key() } }).catch(() => null);
}
