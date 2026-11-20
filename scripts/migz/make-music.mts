// Makes the background-music library: one ElevenLabs Music track per mood (paid, so it only runs with --yes),
// saved to creatives/system/music-library/<mood>/ and, with --out, to a local folder for edit-local.
// A mood that already has a track is skipped unless --force.
// Run: NODE_PATH=scripts/migz/stubs npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/migz/make-music.mts --yes [--out <dir>] [--force] [mood ...]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { supabaseAdmin: db } = await import("@/lib/supabase-admin");
const { composeMusic } = await import("@/lib/migz/narration");
const { MUSIC_MOODS, MUSIC_MOOD_KEYS, MUSIC_LIBRARY } = await import("@/lib/edit/music");

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const moods = wanted.length ? MUSIC_MOOD_KEYS.filter((m) => wanted.includes(m)) : MUSIC_MOOD_KEYS;

if (!flag("--yes")) {
  console.log(`Would make ${moods.length} track(s): ${moods.join(", ")}. Each is a paid ElevenLabs Music call. Add --yes to run.`);
  process.exit(0);
}
if (out) await mkdir(out, { recursive: true });

for (const mood of moods) {
  const { data: have } = await db.storage.from("creatives").list(`${MUSIC_LIBRARY}/${mood}`, { limit: 10 });
  const existing = (have ?? []).find((f) => f.id && /\.mp3$/i.test(f.name));
  if (existing && !flag("--force")) {
    console.log(`${mood}: already has ${existing.name}`);
    if (out) {
      const { data } = await db.storage.from("creatives").download(`${MUSIC_LIBRARY}/${mood}/${existing.name}`);
      if (data) await writeFile(join(out, `${mood}.mp3`), Buffer.from(await data.arrayBuffer()));
    }
    continue;
  }
  const audio = await composeMusic(null, 30, MUSIC_MOODS[mood].prompt);
  const { error } = await db.storage.from("creatives").upload(`${MUSIC_LIBRARY}/${mood}/${mood}-1.mp3`, audio, { contentType: "audio/mpeg", upsert: true });
  if (error) throw error;
  if (out) await writeFile(join(out, `${mood}.mp3`), audio);
  console.log(`${mood}: made ${(audio.length / 1024).toFixed(0)} KB`);
}
