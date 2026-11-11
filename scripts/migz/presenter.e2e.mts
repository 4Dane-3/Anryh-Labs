// LIVE end-to-end test of the roofer "on camera" video: real Claude (script and hook), real ElevenLabs (voice,
// transcript, sound effects, music), real Higgsfield (b-roll from job photos), real HeyGen (lip sync, when
// HEYGEN_API_KEY is set) and the real ffmpeg edit, against the Supabase project in .env.local. It costs a few
// dollars of credits per run.
//
// It creates a throwaway roofing account (`e2e-presenter-*`) with a made-up presenter (an AI-generated face, not a
// real person), makes the videos into its library only (no ad set, nothing reaches Meta, nobody is messaged), saves
// the finished MP4s to e2e-output/, and deletes the account and its files at the end, even on failure.
//
//   NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json node --import tsx scripts/migz/presenter.e2e.mts
//
// Without HEYGEN_API_KEY it runs the "film it yourself" path with a stand-in recording (the presenter photo with
// the ElevenLabs voice), which exercises everything except the lip sync.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.APP_URL = ""; // no Higgsfield webhooks into production: this script polls instead
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};

const { supabaseAdmin: db } = await import("@/lib/supabase-admin");
const { writeScript, startPresenterVideo } = await import("@/lib/migz/presenter");
const { speakScript } = await import("@/lib/migz/presenter-edit");
const { narratorVoices } = await import("@/lib/migz/narration");
const { advanceJobById } = await import("@/lib/migz/creative-jobs");
const { roofingCopyProblem } = await import("@/lib/verticals");
const { heygenReady } = await import("@/lib/heygen");
const FFMPEG = (await import("ffmpeg-static")).default as unknown as string;

const OUT = "e2e-output";
const CACHE = join(OUT, "assets"); // generated test images, reused between runs
mkdirSync(CACHE, { recursive: true });
const step = (s: string) => console.log(`\n▶ ${s}`);
const ok = (s: string) => console.log(`  ✓ ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- test images (Higgsfield text-to-image; no real person) ----------
async function generateImage(name: string, prompt: string, aspect: "9:16" | "4:5") {
  const file = join(CACHE, `${name}.jpg`);
  if (existsSync(file)) return readFileSync(file);
  const auth = `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`;
  const res = await fetch(`https://api.higgsfield.ai${process.env.HF_TEXT_TO_IMAGE_PATH || "/ideogram/v4.0"}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", "Idempotency-Key": `e2e-presenter-${name}-${Date.now()}` },
    body: JSON.stringify({ prompt, aspect_ratio: aspect, rendering_speed: "QUALITY" }),
  });
  if (!res.ok) throw new Error(`Higgsfield image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { status_url } = (await res.json()) as { status_url: string };
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const s = (await (await fetch(status_url, { headers: { Authorization: auth } })).json()) as { status: string; images?: { url: string }[] };
    if (s.status === "completed" && s.images?.[0]?.url) {
      const buf = Buffer.from(await (await fetch(s.images[0].url)).arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    }
    if (["failed", "nsfw", "canceled"].includes(s.status)) throw new Error(`Higgsfield image ${name}: ${s.status}`);
  }
  throw new Error(`Higgsfield image ${name} timed out`);
}

const SLUG = `e2e-presenter-${Math.random().toString(36).slice(2, 8)}`;
let agentId = "";
const uploaded: string[] = [];
let failed = false;

try {
  step("0. Test images: a made-up roofer (AI face) and three job photos");
  const face = await generateImage("presenter", "Photorealistic vertical smartphone photo of a friendly fictional roofing company owner in his mid 40s, short beard, navy work polo, standing in front of a suburban house with a freshly replaced asphalt shingle roof, facing the camera, chest up, soft daylight, natural skin, no text, no logos", "9:16");
  const jobs = await Promise.all([
    generateImage("job1", "Photorealistic photo of a two-story suburban house in the Pacific Northwest with a brand new charcoal architectural shingle roof, clean gutters, overcast daylight, no people, no text", "4:5"),
    generateImage("job2", "Photorealistic close-up of a roofer's gloved hands nailing new asphalt shingles on a roof, sunny day, no faces, no text", "4:5"),
    generateImage("job3", "Photorealistic photo of an old worn roof with curling shingles and moss next to the same style house with a new roof, daylight, no people, no text", "4:5"),
  ]);
  ok(`presenter photo ${Math.round(face.length / 1024)} KB, ${jobs.length} job photos`);

  step("1. A throwaway roofing account");
  const { data: created, error } = await db
    .from("agents")
    .insert({ slug: SLUG, full_name: "Summit Peak Roofing", email: `${SLUG}@example.com`, vertical: "roofing", service_area: "Kenmore, WA", timezone: "America/Los_Angeles", active: true, licensed_states: ["WA"], onboarding_completed_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  agentId = created!.id as string;
  const agent = created as never;
  const put = async (name: string, buf: Buffer, type: string) => {
    const path = `${agentId}/${name}`;
    const { error: e } = await db.storage.from("creatives").upload(path, buf, { contentType: type, upsert: true });
    if (e) throw e;
    uploaded.push(path);
    return path;
  };
  const photoPath = await put("presenter.jpg", face, "image/jpeg");
  const jobPaths = await Promise.all(jobs.map((b, i) => put(`job${i + 1}.jpg`, b, "image/jpeg")));
  ok(`${SLUG} with its photos in storage`);

  // Who's on camera needs migration 20261210000000; without it the test still runs, minus the name check
  const presenter = { agent_id: agentId, mode: "none", towns: ["Kenmore", "Bothell"], offer: null as string | null, badge: null as string | null, photo_paths: [photoPath], job_photo_paths: jobPaths, consent_name: "E2E Test", consent_at: new Date().toISOString() };
  let onCamera = true;
  const { error: pe } = await db.from("agent_presenters").insert({ ...presenter, on_camera_name: "Gil", on_camera_role: "Owner", on_camera_voice: "male" });
  if (pe) {
    if (!/on_camera/.test(pe.message)) throw pe;
    onCamera = false;
    console.log("  ! migration 20261210000000_presenter_on_camera.sql isn't run yet: skipping the who's-on-camera check");
    const { error: pe2 } = await db.from("agent_presenters").insert(presenter);
    if (pe2) throw pe2;
  }

  step("2. Scripts and hooks (real Claude)");
  const plain = await writeScript(agent);
  console.log(`    callout: ${plain.callout}\n    hook: ${plain.hook_line}\n    script: ${plain.script}\n    headline: ${plain.headline}`);
  assert.ok(plain.callout && plain.callout.split(/\s+/).length <= 4, "a 2-4 word callout");
  assert.ok(/kenmore|bothell/i.test(`${plain.callout} ${plain.hook_line}`), "the hook names a town");
  for (const t of [plain.callout, plain.hook_line, plain.script, plain.primary_text, plain.headline]) assert.equal(roofingCopyProblem(t), null, t);
  assert.ok(!/certif|shinglemaster|master elite|preferred contractor|bbb|a\+ rated/i.test(plain.script), "no certification when none was given");
  assert.ok(!/\$\d|% off|discount/i.test(plain.script), "no offer when none was given");
  assert.match(plain.script, /learn more/i, "ends on the call to action");
  if (onCamera) assert.match(plain.script, /\bGil\b/, "introduces who's on camera");
  ok(`no certification or offer invented; town in the hook; passes the Housing copy rules${onCamera ? "; introduces Gil" : ""}`);

  await db.from("agent_presenters").update({ badge: "CertainTeed ShingleMaster", offer: "$500 off a full replacement" }).eq("agent_id", agentId);
  const badged = await writeScript(agent);
  console.log(`    callout: ${badged.callout}\n    hook: ${badged.hook_line}\n    script: ${badged.script}`);
  assert.match(`${badged.hook_line} ${badged.script}`, /ShingleMaster|CertainTeed/i, "uses the certification they gave");
  for (const t of [badged.callout, badged.hook_line, badged.script, badged.primary_text, badged.headline]) assert.equal(roofingCopyProblem(t), null, t);
  ok("uses the certification they gave, still within the rules");

  step(heygenReady() ? "3. The AI version (HeyGen lip sync) plus Higgsfield b-roll" : "3. HEYGEN_API_KEY isn't in .env.local: the film path with a stand-in recording");
  const mode = heygenReady() ? "ai" : "film";
  if (mode === "film") {
    // A stand-in phone recording: the presenter photo, slowly pushing in, speaking the script in an ElevenLabs voice
    const voice = await speakScript(badged.script, narratorVoices("male"));
    const dir = join(OUT, "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "voice.mp3"), voice);
    writeFileSync(join(dir, "face.jpg"), face);
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-loop", "1", "-i", join(dir, "face.jpg"), "-i", join(dir, "voice.mp3"), "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0006,1.15)':d=1:s=720x1280:fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", join(dir, "film.mp4")]);
    const filmPath = await put("film.mp4", readFileSync(join(dir, "film.mp4")), "video/mp4");
    await db.from("agent_presenters").update({ mode: "film", film_path: filmPath }).eq("agent_id", agentId);
  } else {
    await db.from("agent_presenters").update({ mode: "ai" }).eq("agent_id", agentId);
  }
  const jobId = await startPresenterVideo(agent);
  const { data: started } = await db.from("creative_jobs").select("brief, parts").eq("id", jobId).single();
  const plan = (started!.brief as { presenter: { callout: string; script: string; narrator?: string } }).presenter;
  console.log(`    job ${jobId}: ${(started!.parts as unknown[]).length} generations started; callout "${plan.callout}"`);
  assert.equal((started!.parts as { provider?: string }[]).filter((p) => p.provider === "heygen").length, mode === "ai" ? 1 : 0);
  assert.equal((started!.parts as { provider?: string }[]).filter((p) => p.provider !== "heygen").length, 3, "three b-roll clips from the job photos");
  ok(`${mode === "ai" ? "HeyGen talking video and " : ""}3 Higgsfield clips submitted`);

  step("4. Waiting for the generations, then the edit");
  const t0 = Date.now();
  let stage = "generating";
  while (Date.now() - t0 < 30 * 60_000) {
    await sleep(20_000);
    const r = await advanceJobById(jobId);
    const { data: j } = await db.from("creative_jobs").select("stage, error, parts").eq("id", jobId).single();
    stage = j!.stage as string;
    const done = (j!.parts as { video_url?: string }[]).filter((p) => p.video_url).length;
    console.log(`    ${Math.round((Date.now() - t0) / 1000)}s: ${stage} (${done}/${(j!.parts as unknown[]).length} back) ${r ?? ""}`);
    if (stage === "failed") throw new Error(`The job failed: ${j!.error}`);
    if (stage !== "generating") break;
  }
  assert.equal(stage, "stored", "the finished video is in the library (no ad set, so it stops here)");
  const { data: job } = await db.from("creative_jobs").select("creative_id").eq("id", jobId).single();
  const { data: creative } = await db.from("creatives").select("storage_path, kind").eq("id", job!.creative_id).single();
  uploaded.push(creative!.storage_path as string);
  const { data: file } = await db.storage.from("creatives").download(creative!.storage_path as string);
  const out = join(OUT, `presenter-${mode}.mp4`);
  writeFileSync(out, Buffer.from(await file!.arrayBuffer()));

  step("5. The finished video");
  // ffmpeg prints the stream info and the loudness on stderr
  const { spawnSync } = await import("node:child_process");
  const probe = spawnSync(FFMPEG, ["-hide_banner", "-i", out, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const dims = probe.match(/(\d{3,4})x(\d{3,4})/);
  const dur = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  console.log(`    ${out}: ${dims?.[0]}, ${seconds.toFixed(1)}s, ${/Audio:/.test(probe) ? "with sound" : "NO SOUND"}, ${probe.match(/mean_volume: [-\d.]+ dB/)?.[0] ?? ""}`);
  assert.equal(dims?.[0], "720x1280");
  assert.ok(seconds > 12 && seconds < 61, `${seconds}s`);
  assert.match(probe, /Audio:/);
  for (const at of [0.3, 1.5, seconds / 2, seconds - 2]) {
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-ss", at.toFixed(2), "-i", out, "-frames:v", "1", "-vf", "scale=360:-1", join(OUT, `frame-${mode}-${at.toFixed(1)}s.png`)]);
  }
  ok(`saved ${out} and 4 frames to check the cards and captions`);
  console.log("\nALL PRESENTER E2E STEPS PASSED");
} catch (e) {
  failed = true;
  console.error("\nPRESENTER E2E FAILED:", e);
} finally {
  step("Cleanup");
  if (uploaded.length) await db.storage.from("creatives").remove(uploaded);
  if (agentId) {
    const { data: audio } = await db.storage.from("creatives").list(`presenter/${agentId}`);
    if (audio?.length) await db.storage.from("creatives").remove(audio.map((f) => `presenter/${agentId}/${f.name}`));
    await db.from("agents").delete().eq("id", agentId);
    const { count } = await db.from("agents").select("id", { count: "exact", head: true }).eq("slug", SLUG);
    console.log(`  test account ${SLUG} removed (${count ?? 0} left)`);
  }
  process.exit(failed ? 1 : 0);
}
