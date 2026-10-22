(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { writeFileSync } = await import("node:fs");
const { supabaseAdmin: db } = await import("@/lib/supabase-admin");
const { evaluate } = await import("@/lib/migz/tools");
const { videoPrompt } = await import("@/lib/migz/brief");
const { enqueueGeneration, advanceJobById } = await import("@/lib/migz/creative-jobs");
const { data: demo } = await db.from("agents").select("id, slug").eq("slug", "demo-agent").single();
const input = {
  concept: "a father making sure his family can keep their home with mortgage protection",
  topic: "mortgage_protection",
  style: "Warm natural light, soft film grain, handheld documentary style, muted earthy colors",
  setting: "a real suburban home: the front porch, the warm kitchen and the front door",
  cast: "a man in his early 40s with a short dark beard and a grey sweater; his wife in her late 30s with shoulder-length brown hair; their daughter about 8 with a yellow backpack",
  mood: "quiet worry turning into calm and relief; hopeful, never dark; no hospitals, funerals or caskets",
  hook_line: "Who keeps the house if something happens to you?",
  hook_shot: "Close-up at dusk: the man sits alone on the front porch steps holding a set of house keys, turning them over thoughtfully as the porch light comes on behind him.",
  body_shots: [
    { prompt: "Inside the warm kitchen, he sets the keys in a bowl by the door and watches his wife and daughter smiling as they set the table together.", duration: 4 },
    { prompt: "Later that evening at the same kitchen table, he and his wife look at a laptop together; she rests her hand on his and gives a small, relieved smile.", duration: 4 },
    { prompt: "The next morning, the daughter skips down the same front porch steps with her yellow backpack while both parents wave from the open door in soft morning light.", duration: 4 },
  ],
  voiceover: "Every family plans for the mortgage, until something happens. He made sure his wife and daughter could stay in their home. A free call can help you plan for yours.",
  primary_text: "Who keeps the house if something happens to you? Mortgage protection helps your family stay in the home you built. Book a free call to see your options.",
  headline: "Protect your home",
  launch_adset_id: null,
  title: "Demo: narrated mortgage-protection video",
  reason: "Showing the short-film standard with continuity rules and a voiceover.",
};
const ctx = { now: new Date(), dailyCapCents: 2000, actionsThisRun: 0, generationsThisRun: 0, videosThisRun: 0, openGenerations: 0, adsets: [], scriptedAds: new Map(), libraryCreativeIds: new Set<string>() };
const ev = evaluate("generate_video", input, ctx as never);
if (!ev.ok) { console.log("REFUSED by Migz's validation:", ev.error); process.exit(1); }
const brief = (ev.payload as { brief: Parameters<typeof videoPrompt>[0] }).brief;
writeFileSync(`${process.env.OUT_DIR}/prompt.txt`, videoPrompt(brief));
const jobId = await enqueueGeneration({ agentId: demo!.id, brief: brief as never, launchAdsetId: null });
console.log("job", jobId, "submitted to Higgsfield at", new Date().toISOString());
const deadline = Date.now() + 20 * 60_000;
let stage = "generating";
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 30_000));
  stage = await advanceJobById(jobId);
  const { data: job } = await db.from("creative_jobs").select("stage, error, creative_id").eq("id", jobId).single();
  console.log(new Date().toISOString().slice(11, 19), "→", job!.stage, job!.error ?? "");
  if (job!.stage === "failed") process.exit(1);
  if (job!.stage === "stored" || job!.stage === "launched") {
    const { data: c } = await db.from("creatives").select("storage_path").eq("id", job!.creative_id!).single();
    const { data: file } = await db.storage.from("creatives").download(c!.storage_path);
    const out = `${process.env.OUT_DIR}/demo-narrated-mortgage.mp4`;
    writeFileSync(out, Buffer.from(await file!.arrayBuffer()));
    console.log("SAVED", out);
    process.exit(0);
  }
}
console.log("still", stage, "after 20 minutes");
