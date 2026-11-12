import "server-only";

// The voices a client can pick for their ads: ElevenLabs' own default voices and the whole public Voice Library
// (English), each with a preview clip. Library voices are spoken by id straight from the library: they don't
// take one of the account's custom-voice slots (only cloned voices do).

const API = "https://api.elevenlabs.io";

export type AdVoice = {
  id: string;
  name: string; // "Lyan"
  tagline: string | null; // "Female Genuine Casual Ads"
  gender: string | null;
  age: string | null;
  accent: string | null;
  description: string | null;
  source: "default" | "library";
};

export type VoiceFilter = { gender?: "male" | "female" | null; search?: string | null; page?: number };

const PAGE = 24;
const key = () => process.env.ELEVENLABS_API_KEY ?? "";
export const isVoiceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{16,32}$/.test(v);

// Preview links, by voice id, so the preview route only ever fetches ElevenLabs' own files
const previews = new Map<string, string>();

function split(full: string) {
  const [name, ...rest] = full.split(/\s+-\s+/);
  return { name: name.trim(), tagline: rest.join(" - ").trim() || null };
}

type Raw = { voice_id: string; name: string; gender?: string; age?: string; accent?: string; description?: string | null; descriptive?: string; preview_url?: string | null; labels?: Record<string, string> };

function adVoice(v: Raw, source: AdVoice["source"]): AdVoice {
  if (v.preview_url) previews.set(v.voice_id, v.preview_url);
  const { name, tagline } = split(v.name);
  return {
    id: v.voice_id,
    name,
    tagline: tagline ?? v.descriptive ?? v.labels?.descriptive ?? null,
    gender: v.gender ?? v.labels?.gender ?? null,
    age: (v.age ?? v.labels?.age ?? null)?.replace(/_/g, " ") ?? null,
    accent: v.accent ?? v.labels?.accent ?? null,
    description: v.description?.slice(0, 220) ?? null,
    source,
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "xi-api-key": key() }, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  return (await res.json()) as T;
}

/** ElevenLabs' own voices (always available), then the library's most used English voices for ads. */
export async function findVoices(f: VoiceFilter = {}): Promise<{ voices: AdVoice[]; more: boolean }> {
  if (!key()) return { voices: [], more: false };
  const page = Math.max(0, f.page ?? 0);
  const search = f.search?.trim().slice(0, 60) || null;
  const q = new URLSearchParams({ page_size: String(PAGE), page: String(page), language: "en", sort: "usage_character_count_1y" });
  if (f.gender) q.set("gender", f.gender);
  if (search) q.set("search", search);
  else q.set("use_cases", "advertisement");
  const [defaults, library] = await Promise.all([
    page === 0 ? get<{ voices: Raw[] }>("/v2/voices?page_size=100&voice_type=default").catch(() => ({ voices: [] })) : Promise.resolve({ voices: [] }),
    get<{ voices: Raw[]; has_more: boolean }>(`/v1/shared-voices?${q}`),
  ]);
  const own = defaults.voices
    .map((v) => adVoice(v, "default"))
    .filter((v) => (!f.gender || v.gender === f.gender) && (!search || `${v.name} ${v.tagline} ${v.description}`.toLowerCase().includes(search.toLowerCase())));
  const seen = new Set(own.map((v) => v.id));
  return { voices: [...own, ...library.voices.map((v) => adVoice(v, "library")).filter((v) => !seen.has(v.id))], more: library.has_more };
}

/** The preview clip for a voice listed recently (null when it wasn't, or it has none). */
export async function previewUrl(id: string): Promise<string | null> {
  if (previews.has(id)) return previews.get(id)!;
  // Not listed in this server instance yet: look it up
  const lib = await get<{ voices: Raw[] }>(`/v1/shared-voices?page_size=5&search=${encodeURIComponent(id)}`).catch(() => ({ voices: [] }));
  const hit = lib.voices.find((v) => v.voice_id === id);
  if (hit?.preview_url) return previews.set(id, hit.preview_url).get(id)!;
  const own = await get<Raw>(`/v1/voices/${id}`).catch(() => null);
  return own?.preview_url ? previews.set(id, own.preview_url).get(id)! : null;
}

/** Deletes a cloned voice from the account (frees its slot). Never throws. */
export async function deleteVoice(id: string) {
  if (!key() || !isVoiceId(id)) return;
  await fetch(`${API}/v1/voices/${id}`, { method: "DELETE", headers: { "xi-api-key": key() } }).catch(() => null);
}
