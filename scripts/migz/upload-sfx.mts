// Uploads our sound-effects library so live edits use it: each file goes to creatives/system/sfx-library/<kind>/,
// sorted by filename (src/lib/edit/sfx-library.ts). Shows the sorting first; nothing uploads without --yes.
//   node --env-file=.env.local --import tsx scripts/migz/upload-sfx.mts <folder>          (dry run)
//   node --env-file=.env.local --import tsx scripts/migz/upload-sfx.mts <folder> --yes    (upload)
// --replace also removes library files of a kind that aren't in the folder any more.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SFX_KINDS, sortSfx } from "../../src/lib/edit/sfx-library.ts";

const [dirArg, ...flags] = process.argv.slice(2);
if (!dirArg) {
  console.error("Usage: node --env-file=.env.local --import tsx scripts/migz/upload-sfx.mts <folder> [--yes] [--replace]");
  process.exit(1);
}
const dir = resolve(dirArg);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const { byKind, unmatched } = sortSfx(walk(dir));

// Storage keys can't hold every character a filename can
const key = (p: string) => basename(p).replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
for (const k of SFX_KINDS) console.log(`${k.padEnd(7)} ${byKind[k]?.map((p) => relative(dir, p)).join(", ") || "(none: falls back to the generated sound)"}`);
if (unmatched.length) console.log(`\nNot sorted (rename with whoosh, swoosh, click, pop, ding, riser or hit in the name): ${unmatched.map((p) => relative(dir, p)).join(", ")}`);
if (!flags.includes("--yes")) {
  console.log("\nDry run. Add --yes to upload.");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (run with --env-file=.env.local)");
const db = createClient(url, secret, { auth: { persistSession: false } });
const TYPES: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", aif: "audio/aiff", aiff: "audio/aiff", flac: "audio/flac", ogg: "audio/ogg" };

for (const k of SFX_KINDS) {
  const files = byKind[k] ?? [];
  const prefix = `system/sfx-library/${k}`;
  for (const p of files) {
    const ext = p.split(".").pop()!.toLowerCase();
    const { error } = await db.storage.from("creatives").upload(`${prefix}/${key(p)}`, readFileSync(p), { contentType: TYPES[ext] ?? "application/octet-stream", upsert: true });
    console.log(error ? `✗ ${k}/${key(p)}: ${error.message}` : `✓ ${k}/${key(p)}`);
  }
  if (flags.includes("--replace")) {
    const keep = new Set(files.map(key));
    const { data } = await db.storage.from("creatives").list(prefix, { limit: 100 });
    const stale = (data ?? []).filter((f) => f.id && !keep.has(f.name)).map((f) => `${prefix}/${f.name}`);
    if (stale.length) {
      await db.storage.from("creatives").remove(stale);
      console.log(`  removed ${stale.length} old ${k} file(s)`);
    }
  }
}
