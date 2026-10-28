// Sets the logo an agent's Migz videos end on: uploads the file to the creatives bucket and points the
// agent at it. Usage (from the repo root, with .env.local loaded):
//   NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/migz/set-ad-logo.mts <slug> <logo.png>
//   ... <slug> <logo.png> --corner top_left|top_right|bottom_left|bottom_right   (default top_right)
//   ... <slug> --remove      (stops putting the logo on its ads)
import { readFile } from "node:fs/promises";

(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { supabaseAdmin } = await import("@/lib/supabase-admin");

const args = process.argv.slice(2);
const cornerAt = args.indexOf("--corner");
const corner = cornerAt >= 0 ? args.splice(cornerAt, 2)[1] : null;
const [slug, file] = args;
if (corner && !["top_left", "top_right", "bottom_left", "bottom_right"].includes(corner)) throw new Error("--corner must be top_left, top_right, bottom_left or bottom_right");
if (!slug || !file) throw new Error("Usage: set-ad-logo.mts <slug> <logo file | --remove>");
const { data: agent } = await supabaseAdmin.from("agents").select("id, full_name").eq("slug", slug).single();
if (!agent) throw new Error(`No agent with slug ${slug}`);

if (file === "--remove") {
  await supabaseAdmin.from("agents").update({ ad_logo_path: null }).eq("id", agent.id);
  console.log(`${agent.full_name}: end card off`);
} else {
  const ext = file.toLowerCase().endsWith(".png") ? "png" : file.toLowerCase().match(/\.jpe?g$/) ? "jpg" : null;
  if (!ext) throw new Error("The logo must be a PNG or JPG");
  const path = `${agent.id}/brand/logo.${ext}`;
  const { error } = await supabaseAdmin.storage.from("creatives").upload(path, await readFile(file), { contentType: ext === "png" ? "image/png" : "image/jpeg", upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { error: saveError } = await supabaseAdmin.from("agents").update({ ad_logo_path: path, ...(corner ? { ad_logo_corner: corner } : {}) }).eq("id", agent.id);
  if (saveError) throw new Error(`Couldn't save it (has the ad_end_card_logo migration run?): ${saveError.message}`);
  console.log(`${agent.full_name}: logo set (${path})${corner ? `, corner ${corner}` : ""}`);
}
