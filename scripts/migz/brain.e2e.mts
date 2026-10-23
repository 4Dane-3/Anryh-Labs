// End-to-end Migz brain test: real code + real Supabase (DB and Storage), simulated Meta, Higgsfield,
// Slack and one simulated model per tier (Haiku, Sonnet, Opus advisor) at the network / model-call boundary. Restores the demo agent and deletes everything it
// created in `finally`, even if an assertion fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DateTime } from "luxon";

// ---------- environment ----------
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
Object.assign(process.env, {
  META_SYSTEM_USER_TOKEN: "fake-meta-token",
  META_PIXEL_ID: "pixel_1",
  HF_API_KEY_ID: "hf-id",
  HF_API_KEY_SECRET: "hf-secret",
  APP_URL: "https://app.test",
  ANTHROPIC_API_KEY: "unused-model-is-simulated",
  SLACK_BOT_TOKEN: "xoxb-fake",
  ANRYH_ALERT_SLACK_ID: "U_ADMIN",
  MIGZ_TEST_MODE: "0",
  ELEVENLABS_API_KEY: "el-fake",
});
// supabase-js wants a WebSocket for realtime on Node 20; we never use realtime
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const realFetch = globalThis.fetch;

// ---------- simulated Meta + Higgsfield ----------
const meta = {
  adsetStatus: "ACTIVE",
  adsetBudget: 0,
  learning: undefined as string | undefined,
  videoReady: false,
  ads: new Map<string, string>(), // ad id -> status
  insights: [] as Record<string, unknown>[],
  placements: [] as Record<string, unknown>[],
  calls: [] as { method: string; path: string; body: Record<string, string> }[],
  counter: 0,
  campaigns: 0,
  adsets: 0,
  otherBudgets: new Map<string, number>(), // daily budgets of ad sets after adset_1
};
const slack: { channel: string; text: string; blocks?: unknown[] }[] = [];
const hf = { status: new Map<string, string>(), submitted: [] as { path: string; body: Record<string, unknown> }[] };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f00f0004ff01fe0b52c93c0000000049454e44ae426082", "hex");
// A real 3-second clip (picture + quiet scene sound) and a real "voice" (a speech-band tone), made with the
// bundled ffmpeg, so narration is mixed for real in the pipeline
const { execFileSync: runFfmpeg } = await import("node:child_process");
const { readFileSync: readMedia, mkdtempSync } = await import("node:fs");
const FFMPEG = (await import("ffmpeg-static")).default as unknown as string;
const mediaDir = mkdtempSync(`${process.env.TMPDIR ?? "/tmp/"}migz-e2e-`);
runFfmpeg(FFMPEG, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=360x640:rate=24", "-f", "lavfi", "-i", "anoisesrc=d=3:a=0.002", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", `${mediaDir}/clip.mp4`]);
runFfmpeg(FFMPEG, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=2", "-y", `${mediaDir}/voice.mp3`]);
const MP4 = readMedia(`${mediaDir}/clip.mp4`);
const VOICE = readMedia(`${mediaDir}/voice.mp3`);
const elevenlabs: { text: string; voice: string }[] = [];
const music: { prompt: string; music_length_ms: number }[] = [];

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.origin === new URL(SUPABASE).origin) return realFetch(input, init);
  const method = init?.method ?? "GET";

  if (url.host === "graph.facebook.com") {
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : Object.fromEntries(url.searchParams);
    meta.calls.push({ method, path, body });
    if (body.access_token !== "fake-meta-token") { console.error("TOKEN MISMATCH", method, path, Object.keys(body), init?.body?.constructor?.name, typeof init?.body, String(init?.body).slice(0,120)); throw new Error("bad token"); }
    const id = () => `${++meta.counter}`;
    if (path === "search") return json({ data: [{ key: `region_${body.q}`, name: body.q, type: "region", country_code: "US" }] });
    // The first campaign and ad set are cmp_1 / adset_1 (tracked in `meta`); later ones (per-focus campaigns) get new ids
    if (/^act_\d+\/campaigns$/.test(path)) return json({ id: `cmp_${++meta.campaigns}` });
    if (/^act_\d+\/adsets$/.test(path)) { if (++meta.adsets === 1) meta.adsetBudget = Number(body.daily_budget); else meta.otherBudgets.set(`adset_${meta.adsets}`, Number(body.daily_budget)); return json({ id: `adset_${meta.adsets}` }); }
    if (/^act_\d+\/insights$/.test(path)) return json({ data: body.breakdowns ? meta.placements : meta.insights });
    if (/^act_\d+\/ads$/.test(path) && method === "GET") return json({ data: [...meta.ads].map(([id, status]) => ({ id, status, effective_status: status })) });
    if (/^act_\d+\/ads$/.test(path)) { const adId = `ad_${id()}`; meta.ads.set(adId, body.status); return json({ id: adId }); }
    if (/^act_\d+\/advideos$/.test(path)) return json({ id: "vid_1" });
    if (/^act_\d+\/adimages$/.test(path)) return json({ images: { [body.name]: { hash: "imghash_1" } } });
    if (/^act_\d+\/adcreatives$/.test(path)) return json({ id: `cr_${id()}` });
    if (path === "adset_1" && method === "GET")
      return json({ id: "adset_1", status: meta.adsetStatus, daily_budget: String(meta.adsetBudget), targeting: { geo_locations: {} }, ...(meta.learning ? { learning_stage_info: { status: meta.learning } } : {}) });
    if (path === "adset_1") { if (body.status) meta.adsetStatus = body.status; if (body.daily_budget) meta.adsetBudget = Number(body.daily_budget); return json({ success: true }); }
    if (path === "vid_1") return json({ status: { video_status: meta.videoReady ? "ready" : "processing" } });
    if (path === "vid_1/thumbnails") return json({ data: [{ uri: "https://cdn.test/thumb.jpg", is_preferred: true }] });
    if (path.startsWith("ad_") && method === "POST") { meta.ads.set(path, body.status); return json({ success: true }); }
    if (/^cmp_\d+$/.test(path)) return json({ success: true });
    if (/^adset_\d+$/.test(path) && method === "GET")
      return json({ id: path, status: "ACTIVE", daily_budget: String(meta.otherBudgets.get(path) ?? 0), targeting: { geo_locations: {} } });
    if (/^adset_\d+$/.test(path) && method === "POST") { if (body.daily_budget) meta.otherBudgets.set(path, Number(body.daily_budget)); return json({ success: true }); }
    if (path === "pixel_1/events") return json({ events_received: 1 });
    throw new Error(`Unexpected Meta call: ${method} ${path}`);
  }

  if (url.host === "api.higgsfield.ai") {
    assert.equal((init?.headers as Record<string, string>)?.Authorization, "Key hf-id:hf-secret");
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      const rid = `hf_${hf.submitted.length + 1}`;
      hf.submitted.push({ path: url.pathname, body });
      hf.status.set(rid, "queued");
      return json({ status: "queued", request_id: rid, status_url: `https://api.higgsfield.ai/requests/${rid}/status`, cancel_url: "x" });
    }
    const rid = url.pathname.split("/")[2];
    const status = hf.status.get(rid)!;
    const submittedPath = hf.submitted[Number(rid.split("_")[1]) - 1].path;
    const isImage = submittedPath.includes("ideogram") || submittedPath.includes("soul");
    if (status !== "completed") return json({ status, request_id: rid });
    return json(isImage ? { status, request_id: rid, images: [{ url: "https://cdn.test/image.png" }] } : { status, request_id: rid, video: { url: "https://cdn.test/video.mp4" } });
  }

  if (url.host === "app.test") return new Response("<html>ok</html>", { status: 200 });
  if (url.host === "slack.com") { slack.push(JSON.parse(String(init?.body))); return json({ ok: true }); }
  if (url.host === "api.elevenlabs.io") {
    assert.equal((init?.headers as Record<string, string>)?.["xi-api-key"], "el-fake");
    if (url.pathname === "/v1/music") {
      music.push(JSON.parse(String(init?.body)));
      return new Response(VOICE, { headers: { "content-type": "audio/mpeg" } });
    }
    elevenlabs.push({ text: JSON.parse(String(init?.body)).text, voice: url.pathname.split("/").pop()! });
    return new Response(VOICE, { headers: { "content-type": "audio/mpeg" } });
  }
  if (url.host === "cdn.test") {
    return url.pathname.endsWith(".png")
      ? new Response(PNG, { headers: { "content-type": "image/png" } })
      : new Response(MP4, { headers: { "content-type": "video/mp4" } });
  }
  throw new Error(`Unexpected network call: ${method} ${url}`);
}) as typeof fetch;

// ---------- one simulated model per tier ----------
type Params = { model: string; tools?: { name: string; type?: string; model?: string; max_uses?: number }[]; messages: { role: string; content: unknown }[]; system: { text: string; cache_control?: unknown }[]; betas?: string[]; fallbacks?: unknown; output_config?: { effort?: string; format?: unknown }; [k: string]: unknown };
const TASKS: [RegExp, string][] = [
  [/^You are the auditor/, "audit"], [/^You are the market scout/, "scout"], [/^You check life-insurance ad copy/, "copy_check"],
  [/^You write for an independent/, "feed"], [/weekly Slack report/, "slack"], [/^You are the librarian/, "librarian"],
  [/^You are the creative analyst/, "vision"], [/^You are the senior strategist/, "memo"], [/^Describe this life-insurance ad/, "swipe_traits"], [/^You are Migz AI/, "operator"],
];
const taskOf = (p: Params) => TASKS.find(([re]) => re.test(p.system[0].text))?.[1] ?? "unknown";
const seen: { task: string; model: string }[] = [];
let operatorScript: ((params: Params, call: number) => { content: unknown[]; advisor?: boolean }) | null = null;
let operatorCalls = 0;
let modelAllowed = true;
const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";
const usage = (inp = 800, out = 150) => ({ input_tokens: inp, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const msg = (p: Params, content: unknown[], stop = "end_turn", extra: Record<string, unknown> = {}) => ({ id: `msg_${seen.length}`, type: "message", role: "assistant", model: p.model, content, stop_reason: stop, stop_sequence: null, usage: { ...usage(), ...extra } });
const text = (t: string) => ({ type: "text", text: t });
const toolUse = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: `tu_${name}_${Math.random().toString(36).slice(2, 7)}`, name, input });
const advisorBlocks = () => [
  { type: "server_tool_use", id: `srv_${Math.random().toString(36).slice(2, 7)}`, name: "advisor", input: {} },
  { type: "advisor_tool_result", tool_use_id: "srv", content: { type: "advisor_redacted_result", encrypted_content: "ENCRYPTED-ADVICE", stop_reason: "end_turn" } },
];
const createMessage = async (p: Params) => {
  try {
    if (!modelAllowed) throw new Error(`The model should not have been called in this step (${taskOf(p)})`);
    const task = taskOf(p);
    seen.push({ task, model: p.model });
    assert.ok(p.system[0].cache_control, `${task}: system prompt is cacheable`);
    if (p.model === HAIKU) assert.equal(p.fallbacks, undefined, "Haiku has no server-side fallbacks");
    else { assert.equal(p.fallbacks, "default"); assert.ok(p.betas!.includes("server-side-fallback-2026-07-01")); }
    switch (task) {
      case "audit": {
        const raw = JSON.parse(String(p.messages[0].content)) as { check: string; subject: string; severity: string; facts: string }[];
        return msg(p, [text(JSON.stringify({ findings: raw.map((f) => ({ check: f.check, subject: f.subject, severity: f.severity, summary: `Plain: ${f.facts}` })) }))]);
      }
      case "scout":
        assert.equal(p.tools![0].type, "web_search_20250305");
        return msg(p, [text('<examples>{"examples":[{"source_url":"https://example.org/roundup","advertiser":"Example Life","notes":"A dad packing lunches asks what happens to this routine if he is gone tomorrow morning.","traits":{"angle":"family income","hook_type":"question","opening_image":"dad packing lunches","emotional_tone":"warm","setting":"kitchen","text_legibility":"good","claims":[],"compliance_risk":"low","format":"video","offer":"free call"}}]}</examples>')], "end_turn", { server_tool_use: { web_search_requests: 2 } });
      case "copy_check": return msg(p, [text(JSON.stringify({ ok: true, issues: [] }))]);
      case "feed": return msg(p, [text("Feed: Migz made its changes for this review.")]);
      case "slack": return msg(p, [text("*Your week* — slack report")]);
      case "librarian": return msg(p, [text("- Oct 1: nothing relevant")]);
      case "swipe_traits": return msg(p, [text(JSON.stringify({ angle: "a", hook_type: "q", opening_image: "o", emotional_tone: "t", setting: "s", text_legibility: "l", claims: [], compliance_risk: "low", format: "image", offer: "call" }))]);
      case "vision": {
        assert.equal(p.model, SONNET, "vision runs on Sonnet");
        const blocks = p.messages[0].content as { type: string }[];
        assert.ok(blocks.some((b) => b.type === "image"), "frames are sent as images");
        return msg(p, [text(JSON.stringify({ angle: "peace of mind", hook_type: "statement", opening_image: "mother on porch", emotional_tone: "warm", setting: "porch", text_legibility: "clear", claims: [], compliance_risk: "low", format: "image", offer: "free call" }))]);
      }
      case "memo":
        assert.equal(p.output_config!.effort, "high");
        return msg(p, [text(JSON.stringify({ headline: "Video carries the account", learned: ["The mortgage-protection video books calls; the image doesn't (0 of 7)."], test_next: ["Copy variants on the video"], stop: ["Image ad B"] }))]);
      case "operator": {
        operatorCalls++;
        const adv = p.tools!.find((t) => t.name === "advisor")!;
        assert.equal(adv.type, "advisor_20260301"); assert.equal(adv.model, OPUS); assert.equal(adv.max_uses, 3);
        assert.ok(p.betas!.includes("advisor-tool-2026-03-01"));
        const out = operatorScript!(p, operatorCalls);
        const tools = out.content.some((b) => (b as { type: string }).type === "tool_use");
        const iterations = [{ type: "message", model: p.model, ...usage() }, ...(out.advisor ? [{ type: "advisor_message", model: OPUS, ...usage(3000, 400) }] : [])];
        return msg(p, out.content, tools ? "tool_use" : "end_turn", { iterations });
      }
    }
    throw new Error(`unexpected model task ${task}`);
  } catch (e) { console.error("MODEL-SIDE ASSERT", (e as Error).stack?.split("\n").slice(0, 4).join(" | ")); throw e; }
};
const lastToolResults = (p: Params) => p.messages.at(-1)!.content as { tool_use_id: string; is_error?: boolean; content: string }[];
const snapshotOf = (p: Params) => JSON.parse(String(p.messages[0].content).split("<account_snapshot>")[1].split("</account_snapshot>")[0]);
const teamOf = (p: Params) => JSON.parse(String(p.messages[0].content).split("<team_context>")[1].split("</team_context>")[0]);

// ---------- imports ----------
const { supabaseAdmin } = await import("@/lib/supabase-admin");
const { runMigz, buildEvalContext } = await import("@/lib/migz/agent");
const { buildSnapshot } = await import("@/lib/migz/snapshot");
const { syncAgent } = await import("@/lib/migz/sync");
const { recheck } = await import("@/lib/migz/tools");
const { applyPayload } = await import("@/lib/migz/executor");
const { advanceJobById } = await import("@/lib/migz/creative-jobs");
// Only this test agent's jobs: the shared advanceOpenJobs() would touch real agents' jobs too
const advanceOpenJobs = async (deadline: number) => {
  const { data } = await supabaseAdmin.from("creative_jobs").select("id").eq("agent_id", AGENT_ID).not("stage", "in", "(launched,failed)");
  for (const j of data ?? []) if (Date.now() < deadline) await advanceJobById(j.id);
};
const { getBrainLive, getBrainBoard } = await import("@/lib/migz/brain");
const visitRoute = await import("@/app/api/agents/[slug]/visit/route");

const db = supabaseAdmin;
// A throwaway agent owned by this test: real agents are never touched, and cleanup deletes only it.
const SLUG = `e2e-brain-${Math.random().toString(36).slice(2, 8)}`;
const T0 = new Date(Date.now() - 1000).toISOString();
const { data: created, error: createError } = await db.from("agents").insert({
  slug: SLUG, full_name: "E2E Brain Agent", email: `${SLUG}@example.com`, licensed_states: ["FL", "GA", "TX"],
  // $10/day = one campaign, so the steps below can follow a single ad set; step 8f raises it to test the split
  timezone: "America/Chicago", active: true, daily_budget_cents: 1000, meta_ad_account_id: "act_9990001", meta_page_id: "page_1",
  migz_mode: "approve", slack_user_id: "U_TEST", ad_focus: ["final_expense", "mortgage_protection"],
  onboarding_completed_at: new Date().toISOString(), // finished setup, so Migz may manage its ads
}).select("id").single();
if (createError) throw createError;
const AGENT_ID = created!.id as string;
// The market scout runs weekly and files shared research. Real research may already exist; the test
// never deletes it, it just expects the scout only when it is actually due.
const { data: lastScout } = await db.from("swipe_files").select("created_at").is("agent_id", null).eq("added_by", "scout").order("created_at", { ascending: false }).limit(1).maybeSingle();
const scoutDue = !lastScout || Date.now() - new Date(lastScout.created_at).getTime() > 7 * 86_400_000;
await db.from("wallet_transactions").insert({ agent_id: AGENT_ID, kind: "deposit", amount_cents: 10_000, status: "completed", description: "e2e test funds" });
const getAgent = async () => (await db.from("agents").select("*").eq("id", AGENT_ID).single()).data!;
const testBookingIds: string[] = [];
let failed = false;
const step = (name: string) => console.log(`\n▶ ${name}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
const run = (trigger: "manual" | "schedule" = "manual") => getAgent().then((a) => runMigz(a as never, { trigger, createMessage: createMessage as never }));
const callsFor = async (runId: string) => (await db.from("model_calls").select("task, tier, model, cost_usd, degraded, input_tokens").eq("run_id", runId)).data!;
const eventsFor = async (runId: string) => (await db.from("migz_events").select("step, tier, model, summary, finished_at").eq("run_id", runId).order("id")).data!;

try {

  // ===== 0 =====
  step("0. An agent who hasn't finished setup gets no review, even with money in the account");
  await db.from("agents").update({ onboarding_completed_at: null }).eq("id", AGENT_ID);
  modelAllowed = false;
  const callsBeforeSetup = meta.calls.length;
  const notStarted = await run("schedule");
  assert.equal(notStarted.status, "setup_not_finished");
  assert.equal(meta.calls.length, callsBeforeSetup, "nothing touched in Meta");
  const { count: runsBeforeSetup } = await db.from("migz_runs").select("id", { count: "exact", head: true }).eq("agent_id", AGENT_ID);
  assert.equal(runsBeforeSetup, 0, "not even a run row");
  modelAllowed = true;
  await db.from("agents").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", AGENT_ID);
  ok("funded but setup unfinished: no review, no Meta calls, no campaigns");

  // ===== 1 =====
  step("1. First review: Haiku crew, Opus memo, Sonnet lead blocked until it consults the advisor");
  let firstVideoJob = "";
  operatorScript = (p, call) => {
    const snap = snapshotOf(p);
    const adsetId = snap.campaigns[0].ad_sets[0].adset_id;
    const video = { concept: "Mortgage protection", topic: "mortgage_protection", style: "warm natural light", cast: "a dad in his late 30s and his daughter about 7", setting: "a real suburban home", mood: "worry turning into relief; hopeful, never dark", voiceover: "He thought about who keeps the house. Now his family can stay. A free call can help you plan for yours.", hook_line: "Is your family covered if something happens to you?", hook_shot: "A dad pauses at the door", body_shots: [{ prompt: "Family dinner", duration: 4 }], primary_text: "Is your family covered if something happens to you? Let's make sure.", headline: "Book a free call", launch_adset_id: adsetId, title: "Launched a mortgage-protection video", reason: "No live ads yet." };
    const image = { concept: "Peace of mind", topic: "final_expense", scene: "A mother on a porch swing at sunset", style: "golden hour", overlay_lines: ["Prepare for the worst.", "Protect their peace."], button_text: "Book a free call", aspect_ratio: "4:5", primary_text: "Prepare for the worst, protect their peace.", headline: "Protect their peace", launch_adset_id: adsetId, title: "Launched an image ad", reason: "Cheaper test." };
    if (call === 1) {
      const team = teamOf(p);
      assert.ok(team.strategy_memo, "weekly memo reaches the lead");
      assert.deepEqual(snap.ad_focus.map((f: { topic: string; priority: string }) => [f.topic, f.priority]), [["final_expense", "main focus"], ["mortgage_protection", "focus 2"]]);
      assert.match(snap.ad_focus[0].angle_notes, /Never call out age/);
      assert.ok(p.tools!.find((t) => t.name === "generate_image"), "generation tools offered");
      assert.ok(Array.isArray(team.open_audit_findings));
      return { content: [text("Launching creative."), toolUse("generate_video", video)] };
    }
    if (call === 2) {
      const r = lastToolResults(p);
      assert.ok(r[0].is_error && /Consult the advisor/.test(r[0].content), r[0].content);
      // full history must replay the encrypted advice later: the assistant turn is kept verbatim
      return { advisor: true, content: [...advisorBlocks(), toolUse("generate_video", video), toolUse("generate_image", image), toolUse("search_history", { query: "mortgage protection video" }), toolUse("generate_video", { ...video, concept: "A second video", title: "Second video" })] };
    }
    const r = lastToolResults(p);
    assert.match(r[0].content, /^Proposed/); assert.match(r[1].content, /^Proposed/);
    assert.match(r[2].content, /nothing relevant|No matching history/);
    assert.ok(r[3].is_error && /1 video this review/.test(r[3].content), r[3].content);
    const hist = JSON.stringify(p.messages);
    assert.ok(hist.includes("ENCRYPTED-ADVICE"), "advisor result is replayed unchanged");
    return { content: [text("Proposed a video and an image.")] };
  };
  let res = await run("manual");
  assert.equal(res.status, "succeeded", JSON.stringify(res));
  const run1 = res.runId;
  const calls1 = await callsFor(run1);
  const tasks1 = seen.map((s) => `${s.task}:${s.model}`);
  assert.ok((!scoutDue || tasks1.includes(`scout:${HAIKU}`)) && tasks1.includes(`memo:${OPUS}`) && tasks1.includes(`operator:${SONNET}`) && tasks1.includes(`copy_check:${HAIKU}`) && tasks1.includes(`feed:${HAIKU}`) && tasks1.includes(`slack:${HAIKU}`), tasks1.join(", "));
  ok(`routed: ${[...new Set(tasks1)].join(", ")}`);
  const advisorRow = calls1.find((c) => c.task === "advisor")!;
  assert.equal(advisorRow.model, OPUS); assert.equal(advisorRow.tier, "opus");
  assert.ok(Math.abs(Number(advisorRow.cost_usd) - (3000 * 4 + 400 * 20) / 1e6) < 1e-6);
  const { data: runRow } = await db.from("migz_runs").select("cost_usd, model").eq("id", run1).single();
  const sum = calls1.reduce((s, c) => s + Number(c.cost_usd), 0);
  assert.ok(Math.abs(Number(runRow!.cost_usd) - sum) < 1e-4 && sum > 0, `${runRow!.cost_usd} vs ${sum}`);
  if (scoutDue) {
    const { data: scoutCalls } = await db.from("model_calls").select("cost_usd").eq("run_id", run1).eq("task", "scout");
    assert.ok(Number(scoutCalls![0].cost_usd) >= 0.02, "web searches billed");
  }
  ok(`cost logged per call (${calls1.length} rows, $${sum.toFixed(4)}), advisor tokens billed at Opus rates, run total matches`);
  const ev1 = await eventsFor(run1);
  const steps1 = ev1.map((e) => e.step);
  for (const s of ["auditing", ...(scoutDue ? ["researching"] : []), "remembering", "triaging", "checking", "advising", "drafting", "finished"]) assert.ok(steps1.includes(s), `event ${s} missing: ${steps1.join(",")}`);
  assert.ok(ev1.every((e) => e.finished_at), "every step closed");
  assert.ok(ev1.some((e) => e.step === "checking" && /advisor not consulted/.test(e.summary)));
  assert.ok(ev1.some((e) => e.step === "advising" && e.tier === "opus"));
  ok(`event stream: ${steps1.join(" → ")}`);
  const { data: proposals } = await db.from("ad_actions").select("*").eq("agent_id", AGENT_ID).eq("status", "proposed").gte("created_at", T0);
  assert.equal(proposals!.length, 2);
  assert.deepEqual(proposals!.map((x) => x.payload.brief.topic).sort(), ["final_expense", "mortgage_protection"]);
  const { data: swipes } = await db.from("swipe_files").select("added_by, traits").is("agent_id", null).gte("created_at", T0);
  assert.equal(swipes!.length, scoutDue ? 1 : 0);
  const { data: memoLearnings } = await db.from("learnings").select("source").eq("agent_id", AGENT_ID).eq("source", "memo");
  assert.equal(memoLearnings!.length, 1);
  const toAgent = slack.filter((m) => m.channel === "U_TEST");
  assert.equal(toAgent.length, 3, JSON.stringify(slack.map((m) => [m.channel, m.text.slice(0, 40)])));
  assert.ok(toAgent.some((m) => /Migz set up your campaign/.test(m.text) && /FL, GA, TX/.test(JSON.stringify(m.blocks))), "campaign set up, with the states it targets");
  assert.ok(toAgent.some((m) => /Your week/.test(m.text)), "weekly report");
  const summaryMsg = toAgent.find((m) => /waiting for your OK/.test(m.text))!;
  assert.match(summaryMsg.text, /Launched a mortgage-protection video/, "review summary lists the proposals");
  assert.match(JSON.stringify(summaryMsg.blocks), /dashboard\/brain#approvals/, "with a button to approve them in the Brain");
  assert.equal(slack.filter((m) => m.channel === "U_ADMIN").length, 0, "no staff alert on a healthy run");
  ok("2 proposals; scout filed 1 shared swipe example (when due); memo saved a learning; Slack: campaign set up, weekly report, and a review summary with the 2 proposals and an approve button");

  // ===== 2–3 =====
  step("2. Approve, generate and launch");
  let agent = await getAgent();
  const snap2 = await buildSnapshot(agent as never);
  const ctx2 = await buildEvalContext(agent as never, snap2);
  for (const p of proposals!) {
    assert.equal(recheck(p.payload, ctx2), null);
    const applied = await applyPayload(agent as never, p.payload, p.id);
    assert.ok(applied.ok, JSON.stringify(applied));
    if (p.tool === "generate_video") firstVideoJob = (applied as { result: { creative_job_id: string } }).result.creative_job_id;
    await db.from("ad_actions").update({ status: "applied", decided_at: new Date().toISOString() }).eq("id", p.id);
  }
  await advanceOpenJobs(Date.now() + 60_000);
  for (const rid of hf.status.keys()) hf.status.set(rid, "completed");
  await advanceOpenJobs(Date.now() + 60_000);
  meta.videoReady = true;
  await advanceOpenJobs(Date.now() + 60_000);
  const { data: liveAds } = await db.from("ads").select("meta_ad_id, creative_id, creatives(kind)").eq("agent_id", AGENT_ID);
  assert.equal(liveAds!.length, 2);
  const videoAd = liveAds!.find((a) => (a.creatives as { kind: string }).kind === "video")!;
  const imageAd = liveAds!.find((a) => (a.creatives as { kind: string }).kind === "image")!;
  const videoSubmit = hf.submitted.find((x) => x.path.includes("kling"))!;
  assert.match(String(videoSubmit.body.prompt), /^A \d+-second vertical short film about Mortgage protection/);
  assert.match(String(videoSubmit.body.prompt), /The same people appear throughout: a dad in his late 30s/);
  assert.match(String(videoSubmit.body.prompt), /no one looks into the camera/);
  assert.ok((videoSubmit.body.multi_prompt as { prompt: string }[]).every((sh) => /nobody looks at the camera/.test(sh.prompt)));
  // The narrator: ElevenLabs spoke the brief's voiceover and it was mixed over the stored video
  assert.equal(elevenlabs.length, 1, "one voiceover spoken");
  assert.match(elevenlabs[0].text, /^He thought about who keeps the house/);
  assert.equal(elevenlabs[0].voice, "z7U1SjrEq4fDDDriOQEN", "the brief didn't pick a narrator, so Vivie reads it");
  assert.equal(music.length, 1, "one music bed composed");
  assert.match(music[0].prompt, /strings/);
  const { data: storedVideo } = await db.from("creatives").select("storage_path").eq("agent_id", AGENT_ID).eq("kind", "video").order("created_at").limit(1).single();
  const { data: videoFile } = await db.storage.from("creatives").download(storedVideo!.storage_path);
  const { writeFileSync: writeMedia } = await import("node:fs");
  writeMedia(`${mediaDir}/stored.mp4`, Buffer.from(await videoFile!.arrayBuffer()));
  // ffmpeg reports levels on stderr
  const { spawnSync } = await import("node:child_process");
  const levels = spawnSync(FFMPEG, ["-hide_banner", "-i", `${mediaDir}/stored.mp4`, "-vn", "-af", "highpass=f=300,lowpass=f=3400,volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const maxVol = Number((levels.match(/max_volume: (-?[\d.]+) dB/) ?? [])[1]);
  assert.ok(maxVol > -20, `the stored video carries the narrator (speech-band peak ${maxVol} dB)`);
  assert.equal(slack.filter((m) => m.channel === "U_ADMIN" && /Narration failed/.test(m.text)).length, 0, "no narration failures");
  ok(`live: ${videoAd.meta_ad_id} (video, sent to Higgsfield as a short film with the realism rules, narrated by ElevenLabs and mixed over the footage), ${imageAd.meta_ad_id} (image)`);
  void firstVideoJob;

  // ===== 3 =====
  step("3. Perception: video, delivery and placement insights; page visits");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const vids = (n: number) => [{ action_type: "video_view", value: String(n) }];
  meta.insights = [
    { ad_id: videoAd.meta_ad_id, adset_id: "adset_1", campaign_id: "cmp_1", date_start: today, spend: "25.00", impressions: "2600", clicks: "52", reach: "1300", frequency: "2.0", inline_link_clicks: "40",
      actions: [{ action_type: "video_view", value: "780" }, { action_type: "landing_page_view", value: "30" }, { action_type: "offsite_conversion.fb_pixel_schedule", value: "1" }],
      video_play_actions: vids(1100), video_thruplay_watched_actions: vids(234), video_p25_watched_actions: vids(500), video_p50_watched_actions: vids(380), video_p75_watched_actions: vids(290), video_p100_watched_actions: vids(200), video_avg_time_watched_actions: vids(6.4) },
    { ad_id: imageAd.meta_ad_id, adset_id: "adset_1", campaign_id: "cmp_1", date_start: today, spend: "22.00", impressions: "2300", clicks: "7", reach: "1150", frequency: "2.0", inline_link_clicks: "6" },
  ];
  meta.placements = [
    { ad_id: videoAd.meta_ad_id, date_start: today, publisher_platform: "instagram", platform_position: "instagram_reels", spend: "15.00", impressions: "1600", inline_link_clicks: "30", actions: [{ action_type: "video_view", value: "560" }] },
    { ad_id: videoAd.meta_ad_id, date_start: today, publisher_platform: "facebook", platform_position: "feed", spend: "10.00", impressions: "1000", inline_link_clicks: "10", actions: [{ action_type: "video_view", value: "220" }] },
  ];
  meta.learning = "SUCCESS";
  const slot = new Date(Date.now() + 9 * 86_400_000); slot.setUTCHours(15, 0, 0, 0);
  const { data: booking } = await db.from("bookings").insert({ agent_id: AGENT_ID, starts_at: slot.toISOString(), ends_at: new Date(slot.getTime() + 1_800_000).toISOString(), name: "E2E Brain", email: "e2e-brain@example.com", phone: "+15555550112", consent_text: "test", attribution: { utm_source: "meta", utm_content: videoAd.meta_ad_id } }).select("id").single();
  testBookingIds.push(booking!.id);
  for (let i = 0; i < 3; i++) await visitRoute.POST(new Request(`https://app.test/api/agents/${SLUG}/visit`, { method: "POST", body: JSON.stringify({ utm_source: "meta", utm_content: videoAd.meta_ad_id }) }), { params: Promise.resolve({ slug: SLUG }) });
  agent = await getAgent();
  await syncAgent(agent as never);
  const { data: vrow } = await db.from("ad_insights_daily").select("*").eq("meta_ad_id", videoAd.meta_ad_id).eq("date", today).single();
  assert.deepEqual([vrow!.video_3s_views, vrow!.thruplays, vrow!.video_p25, vrow!.video_p100, vrow!.avg_watch_ms, vrow!.link_clicks, vrow!.reach, Number(vrow!.frequency), vrow!.landing_page_views], [780, 234, 500, 200, 6400, 40, 1300, 2, 30]);
  const { data: prow } = await db.from("ad_placement_daily").select("*").eq("meta_ad_id", videoAd.meta_ad_id);
  assert.equal(prow!.length, 2);
  const { count: visits } = await db.from("page_visits").select("id", { count: "exact", head: true }).eq("agent_id", AGENT_ID).gte("created_at", T0);
  assert.equal(visits, 3);
  const snap3 = await buildSnapshot(agent as never);
  const vModel = (snap3.forModel.campaigns[0].ad_sets[0].ads as { ad_id: string; last_14_days: Record<string, unknown> }[]).find((a) => a.ad_id === videoAd.meta_ad_id)!;
  assert.equal(vModel.last_14_days.hook_rate, "30.0%"); assert.equal(vModel.last_14_days.hold_rate, "30.0%"); assert.equal(vModel.last_14_days.visit_to_booking, "33.3%");
  assert.equal((snap3.forModel.campaigns[0].ad_sets[0] as { results_by_placement_last_14_days: unknown[] }).results_by_placement_last_14_days.length, 2);
  ok("stored 3s views, ThruPlays, quartiles, watch time, link clicks, reach, frequency; 2 placement rows; 3 visits; hook 30%, hold 30%, visit→booking 33%");

  // ===== 4 =====
  step("4. Auto review: vision traits, diagnose, pause + copy variants + experiment; no early verdict");
  await db.from("agents").update({ migz_mode: "auto", migz_last_run_at: null }).eq("id", AGENT_ID);
  // The copy-lift guardrail needs a market example to compare against; use this agent's own swipe row
  // so the test doesn't depend on whether the shared scout ran (its rows aren't ours to delete)
  await db.from("swipe_files").insert({ agent_id: AGENT_ID, advertiser: "Example Life", notes: "A dad packing lunches asks what happens to this routine if he is gone tomorrow morning.", added_by: "agent" });
  operatorCalls = 0;
  let copyAdIds: string[] = [];
  let expId = "";
  operatorScript = (p, call) => {
    if (call === 1) return { content: [toolUse("diagnose_creative", { ad_id: imageAd.meta_ad_id })] };
    if (call === 2) {
      const d = JSON.parse(lastToolResults(p)[0].content);
      assert.equal(d.traits.angle, "peace of mind");
      assert.ok(d.diagnosis.rung);
      return { advisor: true, content: [...advisorBlocks(),
        toolUse("pause_ad", { ad_id: imageAd.meta_ad_id, title: "Paused the image ad", reason: "Link CTR 0.26% vs the video's 1.54%." }),
        toolUse("write_copy_variants", { source_ad_id: videoAd.meta_ad_id, variants: [{ primary_text: "Your work policy ends when your job does. Keep your family covered.", headline: "Coverage that stays" }], title: "Testing new copy on the video", reason: "Hook and hold are strong; test the offer." }),
        toolUse("write_copy_variants", { source_ad_id: videoAd.meta_ad_id, variants: [{ primary_text: "A dad packing lunches asks what happens to this routine if he is gone", headline: "x" }], title: "Lifted copy", reason: "test" }),
      ] };
    }
    if (call === 3) {
      const r = lastToolResults(p);
      assert.match(r[0].content, /^Done/); assert.match(r[1].content, /^Done/, r[1].content);
      assert.ok(r[2].is_error && /lifted/.test(r[2].content), r[2].content);
      copyAdIds = JSON.parse(r[1].content.replace(/^Done\. /, "")).ad_ids;
      return { content: [toolUse("plan_experiment", { hypothesis: "Work-coverage copy beats family copy on link CTR", rationale: "Hold 30% but CTR lags", lever: "copy", success_metric: "link_ctr", variants: [{ label: "control", ad_id: videoAd.meta_ad_id, creative_job_id: null }, { label: "work copy", ad_id: copyAdIds[0], creative_job_id: null }], min_impressions: 1500, min_thruplays: 0 }),
        toolUse("record_learning", { insight: "Image ads lag video on this account (CTR 0.26% vs 1.54%).", confidence: "medium", source: "review", experiment_id: null })] };
    }
    if (call === 4) {
      const r = lastToolResults(p);
      // advice was earlier in this review, so planning the experiment is allowed
      assert.match(r[0].content, /^Planned experiment/, r[0].content); assert.match(r[1].content, /Saved/);
      expId = r[0].content.match(/experiment ([0-9a-f-]{36})/)![1];
      return { content: [toolUse("conclude_experiment", { experiment_id: expId, verdict: "winner", winner_label: "work copy", summary: "Too soon." })] };
    }
    const r = lastToolResults(p);
    assert.ok(r[0].is_error && /never end one early/.test(r[0].content), r[0].content);
    return { content: [text("Paused the image, started a copy test.")] };
  };
  res = await run("manual");
  assert.equal(res.status, "succeeded", JSON.stringify(res));
  assert.equal(meta.ads.get(imageAd.meta_ad_id), "PAUSED");
  assert.equal(copyAdIds.length, 1); assert.equal(meta.ads.get(copyAdIds[0]), "ACTIVE");
  const { data: imgCreative } = await db.from("creatives").select("traits").eq("id", imageAd.creative_id!).single();
  assert.equal((imgCreative!.traits as { angle: string }).angle, "peace of mind");
  const { data: expRow } = await db.from("experiments").select("status, variants").eq("id", expId).single();
  assert.equal(expRow!.status, "running");
  ok("image traits from vision; diagnosed; paused image; 1 copy variant live; lifted copy refused; experiment running; early verdict refused");

  // ===== 5 =====
  step("5. Quiet run: nothing material changed → no model is called");
  modelAllowed = false;
  res = await run("schedule");
  assert.equal(res.status, "skipped", JSON.stringify(res));
  const ev5 = await eventsFor(res.runId);
  assert.ok(ev5.some((e) => e.step === "skipped" && /skipped: quiet/.test(e.summary)));
  assert.equal((await callsFor(res.runId)).length, 0);
  modelAllowed = true;
  ok("run skipped: quiet, zero model calls");

  // ===== 5b =====
  step("5b. Agent changes their ad focus → next scheduled check runs a full review");
  await db.from("agents").update({ ad_focus: ["income_protection"] }).eq("id", AGENT_ID);
  operatorCalls = 0;
  const story = (lines: string[]) => ({ concept: "Income protection", topic: "income_protection", scene: "A father tucks his daughter into bed, hallway light behind him", style: "warm cinematic", overlay_lines: lines, button_text: null, aspect_ratio: "9:16", primary_text: "If your paycheck stopped tomorrow, how long could your family keep up? A free call walks you through it.", headline: "Protect their routine", launch_adset_id: null, title: "Started a Stories image", reason: "No income-protection creative yet." });
  const submittedBefore = hf.submitted.length;
  operatorScript = (p, call) => {
    if (call === 1) {
      assert.match(String(p.messages[0].content), /changed their ad focus/);
      const snap = snapshotOf(p);
      assert.equal(snap.ad_focus[0].topic, "income_protection");
      assert.equal(snap.ad_focus[0].live_ads_on_this_topic, 0);
      return { content: [toolUse("generate_image", story([])), toolUse("generate_image", story(["What if the paycheck stopped?"]))] };
    }
    const r = lastToolResults(p);
    assert.ok(r[0].is_error && /Every image carries its message/.test(r[0].content), r[0].content);
    assert.match(r[1].content, /^Done/, r[1].content);
    return { content: [text("Started a Stories image for the new focus.")] };
  };
  res = await run("schedule");
  assert.equal(res.status, "succeeded", JSON.stringify(res));
  const newSubmits = hf.submitted.slice(submittedBefore);
  assert.equal(newSubmits.length, 1);
  assert.equal(newSubmits[0].path, "/ideogram/v4.0");
  assert.equal(newSubmits[0].body.aspect_ratio, "9:16");
  assert.match(String(newSubmits[0].body.prompt), /"What if the paycheck stopped\?"/);
  ok("focus change triggered a review; the lead saw the new focus; a 9:16 image went to the text model with its line on it, and an image with no words was refused");

  // ===== 6 =====
  step("6. Experiment reaches its sample → verdict and learning");
  meta.insights.push(
    { ad_id: videoAd.meta_ad_id, adset_id: "adset_1", campaign_id: "cmp_1", date_start: new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }), spend: "5", impressions: "400", clicks: "8", inline_link_clicks: "6" },
    { ad_id: copyAdIds[0], adset_id: "adset_1", campaign_id: "cmp_1", date_start: today, spend: "20", impressions: "1600", clicks: "40", inline_link_clicks: "35" },
  );
  operatorCalls = 0;
  operatorScript = (p, call) => {
    if (call === 1) {
      const team = teamOf(p);
      const live = team.live_experiments.find((e: { experiment_id: string }) => e.experiment_id === expId);
      assert.equal(live.ready_for_verdict, true);
      assert.match(String(p.messages[0].content), /experiment\(s\) ready for a verdict/);
      return { advisor: true, content: [...advisorBlocks(), toolUse("conclude_experiment", { experiment_id: expId, verdict: "winner", winner_label: "work copy", summary: "Work copy doubled link CTR." })] };
    }
    if (call === 2) {
      assert.match(lastToolResults(p)[0].content, /^Concluded/);
      return { content: [toolUse("record_learning", { insight: "Work-coverage copy beats family copy on link CTR for this account.", confidence: "high", source: "experiment", experiment_id: expId })] };
    }
    return { content: [text("Closed the copy test.")] };
  };
  res = await run("schedule");
  assert.equal(res.status, "succeeded", JSON.stringify(res));
  const { data: done } = await db.from("experiments").select("status, verdict, winner_label, result").eq("id", expId).single();
  assert.deepEqual([done!.status, done!.verdict, done!.winner_label], ["concluded", "winner", "work copy"]);
  assert.equal((done!.result as { variants: unknown[] }).variants.length, 2);
  const { data: expLearning } = await db.from("learnings").select("evidence").eq("experiment_id", expId).single();
  assert.ok((expLearning!.evidence as { experiment: unknown }).experiment);
  ok("gate ran for the ready experiment; concluded with account numbers; learning saved with evidence");

  // ===== 7 =====
  step("7. Monthly ceiling reached → cheaper tiers, Opus advisor still required");
  await db.from("agents").update({ migz_model_budget_cents: 1, migz_last_weekly_at: null }).eq("id", AGENT_ID);
  await db.from("swipe_files").delete().is("agent_id", null).eq("added_by", "scout").gte("created_at", T0); // only rows this test made, so the scout is due again
  operatorCalls = 0;
  const before = seen.length;
  operatorScript = (p, call) => {
    assert.equal(p.model, HAIKU, "operator degraded to Haiku");
    assert.equal(p.tools!.find((t) => t.name === "advisor")!.model, OPUS, "advisor stays Opus");
    if (call === 1) return { content: [toolUse("resume_ad", { ad_id: imageAd.meta_ad_id, title: "Resumed image", reason: "test" })] };
    if (call === 2) { assert.ok(lastToolResults(p)[0].is_error && /Consult the advisor/.test(lastToolResults(p)[0].content)); return { content: [text("Holding.")] }; }
    return { content: [text("done")] };
  };
  res = await run("manual");
  assert.equal(res.status, "succeeded", JSON.stringify(res));
  const after = seen.slice(before);
  assert.ok(!after.some((s) => s.task === "scout"), "scout skipped over budget");
  assert.ok(after.some((s) => s.task === "memo" && s.model === SONNET), "memo degraded to Sonnet");
  const calls7 = await callsFor(res.runId);
  assert.ok(calls7.some((c) => c.task === "operator" && c.degraded && c.model === HAIKU));
  if (scoutDue) assert.ok((await eventsFor(res.runId)).some((e) => /market research/.test(e.summary)));
  ok("over budget: scout skipped, memo on Sonnet, operator on Haiku (degraded logged), advisor rule unchanged");

  // ===== 8 =====
  step("8. Brain page data");
  agent = await getAgent();
  const live = await getBrainLive(agent as never);
  assert.ok(live.events.length > 20); assert.equal(live.running, false); assert.ok(live.nextRunAt);
  const newer = await getBrainLive(agent as never, live.events.at(-3)!.id);
  assert.equal(newer.events.length, 2);
  const board = await getBrainBoard(agent as never);
  assert.ok(board.cost.byTier.opus > 0 && board.cost.byTier.haiku > 0 && board.cost.advisorCalls >= 3);
  assert.ok(board.scorecards.length >= 2 && board.scorecards.some((s) => s.hook_rate !== null));
  assert.ok(board.experiments.some((e) => e.status === "concluded")); assert.ok(board.learnings.length >= 3);
  ok(`events polled incrementally; cost by tier $${board.cost.totalUsd.toFixed(4)}; ${board.scorecards.length} scorecards; experiments + learnings present`);

  await db.from("agents").update({ migz_model_budget_cents: 3000 }).eq("id", AGENT_ID); // back to the normal tiers after step 7
  // ===== 8b =====
  step("8b. Campaign end date: ads pause after the last day, and resume when it's extended");
  // Calendar days in the agent's timezone (adding 24-hour blocks drifts a day across a DST change)
  const ymd = (d: number) => DateTime.now().setZone("America/Chicago").plus({ days: d }).toISODate()!;
  await db.from("agents").update({ campaign_ends_on: ymd(-1), migz_last_run_at: null }).eq("id", AGENT_ID);
  modelAllowed = false;
  const endedRun = await run("manual");
  assert.equal(endedRun.status, "paused", JSON.stringify(endedRun));
  assert.equal(meta.adsetStatus, "PAUSED");
  const { data: endAction } = await db.from("ad_actions").select("title, detail").eq("agent_id", AGENT_ID).eq("tool", "system_pause").order("created_at", { ascending: false }).limit(1).single();
  assert.equal(endAction!.title, "Your campaign batch has ended"); assert.match(endAction!.detail, /next batch from the Overview/);
  modelAllowed = true;
  operatorScript = () => ({ content: [text("Resumed after the campaign was extended.")] });
  await db.from("agents").update({ campaign_ends_on: ymd(10), migz_last_run_at: null }).eq("id", AGENT_ID);
  const resumed = await run("manual");
  assert.equal(resumed.status, "succeeded", JSON.stringify(resumed));
  assert.equal(meta.adsetStatus, "ACTIVE");
  const snapAfter = await buildSnapshot((await getAgent()) as never);
  assert.equal((snapAfter.forModel.agent.campaign as { days_left: number }).days_left, 11);
  await db.from("agents").update({ campaign_ends_on: null, migz_last_run_at: null }).eq("id", AGENT_ID);
  ok("ended campaign paused ads with a clear message (no AI call), extending it resumed them, and Migz sees the days left");

  // ===== 8c =====
  step("8c. Test mode, then going live: the campaign AND its paused ad sets switch on");
  process.env.MIGZ_TEST_MODE = "1";
  meta.adsetStatus = "PAUSED";
  await db.from("ad_sets").update({ status: "PAUSED" }).eq("agent_id", AGENT_ID);
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  operatorScript = () => ({ content: [text("Test mode: held.")] });
  assert.equal((await run("manual")).status, "succeeded");
  const { data: cTest } = await db.from("ad_campaigns").select("status").eq("agent_id", AGENT_ID);
  assert.ok(cTest!.length && cTest!.every((c) => c.status === "PAUSED"));
  assert.equal(meta.adsetStatus, "PAUSED", "test mode doesn't touch the ad set");
  process.env.MIGZ_TEST_MODE = "0";
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  await run("manual");
  const { data: cLive } = await db.from("ad_campaigns").select("status").eq("agent_id", AGENT_ID);
  assert.ok(cLive!.every((c) => c.status === "ACTIVE"));
  assert.equal(meta.adsetStatus, "ACTIVE", "the paused ad set was switched on with the campaign");
  const { data: liveSets } = await db.from("ad_sets").select("status").eq("agent_id", AGENT_ID);
  assert.ok(liveSets!.every((x) => x.status === "ACTIVE"));
  // One go-live entry per campaign (two since the focus change in 5b); the one whose ad set was paused says so
  const { data: goLive } = await db.from("ad_actions").select("detail").eq("agent_id", AGENT_ID).eq("tool", "system_test_mode").order("created_at", { ascending: false }).limit(2);
  assert.ok(goLive!.some((a) => /switched on too/.test(a.detail)), JSON.stringify(goLive));
  // An agent who paused their own ads is never switched on by this
  await db.from("agents").update({ ads_paused: true, migz_last_run_at: null }).eq("id", AGENT_ID);
  process.env.MIGZ_TEST_MODE = "1";
  modelAllowed = false;
  await run("manual");
  process.env.MIGZ_TEST_MODE = "0";
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  await run("manual");
  assert.equal(meta.adsetStatus, "PAUSED", "ads_paused agents stay paused");
  await db.from("agents").update({ ads_paused: false, migz_last_run_at: null }).eq("id", AGENT_ID);
  modelAllowed = true;
  operatorScript = () => ({ content: [text("Back on.")] });
  await run("manual");
  ok("leaving test mode switched on the campaign and its paused ad set; an agent-paused account stays paused");

  // ===== 8d =====
  step("8d. Test mode builds the finished ad paused in Meta; going live switches it on");
  process.env.MIGZ_TEST_MODE = "1";
  meta.adsetStatus = "PAUSED";
  await db.from("ad_sets").update({ status: "PAUSED" }).eq("agent_id", AGENT_ID);
  await db.from("ad_campaigns").update({ status: "PAUSED" }).eq("agent_id", AGENT_ID);
  await db.from("agents").update({ migz_mode: "auto", migz_last_run_at: null }).eq("id", AGENT_ID);
  const heldImage = { concept: "Final expense", topic: "final_expense", scene: "A grandmother and granddaughter at a kitchen table, afternoon light", style: "warm golden hour", overlay_lines: ["Plan ahead for them."], button_text: "Book a free call", aspect_ratio: "4:5", primary_text: "A small plan now spares your family a big bill later. A free call walks you through it.", headline: "Plan ahead", launch_adset_id: "adset_1", title: "Built a final-expense image", reason: "No final-expense ad yet." };
  operatorCalls = 0;
  operatorScript = (p, call) => {
    if (call === 1) {
      assert.match(JSON.stringify(snapshotOf(p).agent.test_mode), /built paused/);
      return { advisor: true, content: [...advisorBlocks(), toolUse("generate_image", heldImage)] };
    }
    assert.match(lastToolResults(p)[0].content, /^Done/, lastToolResults(p)[0].content);
    return { content: [text("Built the final-expense image paused.")] };
  };
  const adsBefore = new Set(meta.ads.keys());
  const buildRun = await run("manual");
  assert.equal(buildRun.status, "succeeded", JSON.stringify(buildRun));
  for (const rid of hf.status.keys()) hf.status.set(rid, "completed");
  await advanceOpenJobs(Date.now() + 60_000);
  const builtIds = [...meta.ads.keys()].filter((id) => !adsBefore.has(id));
  assert.equal(builtIds.length, 1, "one finished ad exists in Meta");
  assert.equal(meta.ads.get(builtIds[0]), "PAUSED", "built paused: previewable, can't deliver");
  const { data: heldRow } = await db.from("ads").select("status, held_by_test_mode").eq("meta_ad_id", builtIds[0]).single();
  assert.deepEqual([heldRow!.status, heldRow!.held_by_test_mode], ["PAUSED", true]);
  process.env.MIGZ_TEST_MODE = "0";
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  operatorScript = () => ({ content: [text("Live.")] });
  await run("manual");
  assert.equal(meta.ads.get(builtIds[0]), "ACTIVE", "the held ad switched on with the campaign");
  const { data: liveRow } = await db.from("ads").select("status, held_by_test_mode").eq("meta_ad_id", builtIds[0]).single();
  assert.deepEqual([liveRow!.status, liveRow!.held_by_test_mode], ["ACTIVE", false]);
  ok("test mode: the ad was built in Meta paused (previewable, can't deliver); leaving test mode switched it on");

  // ===== 8e =====
  step("8e. A recent out-of-credits failure makes Migz try ONE creative (not give up), so it recovers when credits return");
  await db.from("creative_jobs").insert({ agent_id: AGENT_ID, stage: "failed", error: 'Higgsfield 403: "not_enough_credits"', brief: { concept: "x" } });
  const snapCredits = await buildSnapshot((await getAgent()) as never);
  assert.match(String(snapCredits.forModel.agent.creative_generation), /Try ONE creative/);
  const ctxCredits = await buildEvalContext((await getAgent()) as never, snapCredits);
  assert.equal(ctxCredits.maxGenerations, 1);
  await db.from("creative_jobs").insert({ agent_id: AGENT_ID, stage: "launched", brief: { concept: "y" } }); // a later attempt worked
  const snapOk = await buildSnapshot((await getAgent()) as never);
  assert.equal(snapOk.forModel.agent.creative_generation, "available");
  ok("after a credits refusal the next review is allowed one creative; once an attempt works it's back to normal");

  // ===== 8f =====
  step("8f. The plan: one campaign per focus while the budget covers them, extras follow the focus order; 7 days of results before revisions");
  // $10/day started one final-expense campaign; switching the focus to income protection (5b) added one for it
  const { data: beforePlan } = await db.from("ad_campaigns").select("topic").eq("agent_id", AGENT_ID).order("created_at");
  assert.deepEqual(beforePlan!.map((c) => c.topic), ["final_expense", "income_protection"]);
  await db.from("wallet_transactions").insert({ agent_id: AGENT_ID, kind: "deposit", amount_cents: 56_000, status: "completed", description: "e2e test funds for the 4-campaign plan" });
  await db.from("agents").update({ daily_budget_cents: 4000, ad_focus: ["final_expense", "mortgage_protection", "income_protection"], migz_mode: "approve", migz_last_run_at: null }).eq("id", AGENT_ID);
  operatorScript = () => ({ content: [text("Plan set up.")] });
  assert.equal((await run("manual")).status, "succeeded");
  const { data: planned } = await db.from("ad_campaigns").select("name, topic, ad_sets(daily_budget_cents)").eq("agent_id", AGENT_ID).order("created_at");
  assert.deepEqual(planned!.map((c) => c.topic).sort(), ["final_expense", "final_expense", "income_protection", "mortgage_protection"]);
  assert.ok(planned!.every((c) => (c.ad_sets as { daily_budget_cents: number }[]).every((x) => x.daily_budget_cents === 1000)), JSON.stringify(planned));
  assert.equal(meta.adsetBudget, 1000);
  assert.ok([...meta.otherBudgets.values()].every((b) => b === 1000));
  assert.ok(planned!.some((c) => / B · /.test(c.name)), "the second final-expense campaign is labelled B");
  const { data: setupLog } = await db.from("ad_actions").select("title").eq("agent_id", AGENT_ID).eq("tool", "system_setup").order("created_at", { ascending: false }).limit(1).single();
  assert.equal(setupLog!.title, "Set up 2 campaigns", "only the missing slots are built");
  const snapPlan = await buildSnapshot((await getAgent()) as never);
  assert.match(JSON.stringify(snapPlan.forModel.campaigns.map((c) => c.serves_topic)), /mortgage_protection \(Mortgage protection\)/);
  // A campaign that started today is collecting results: pauses and budget moves are refused until day 8
  const { DateTime: DT } = await import("luxon");
  await db.from("agents").update({ campaign_started_on: DT.now().setZone("America/Chicago").toISODate() }).eq("id", AGENT_ID);
  const snapNew = await buildSnapshot((await getAgent()) as never);
  assert.match(String((snapNew.forModel.agent.campaign as { phase: string }).phase), /collecting results/);
  const ctxNew = await buildEvalContext((await getAgent()) as never, snapNew);
  const { checkPauseAd, checkBudgetChange } = await import("@/lib/migz/guardrails");
  assert.match(checkPauseAd(ctxNew, "ad_x") ?? "", /first week of results/);
  assert.match(checkBudgetChange(ctxNew, "adset_1", 1100) ?? "", /first week of results/);
  await db.from("agents").update({ campaign_started_on: null }).eq("id", AGENT_ID);
  ok("$40/day over 3 focuses = 4 campaigns (2 on the main focus), $10/day each; the first week refuses revisions");

  // ===== 8g =====
  step("8g. A campaign batch: Migz sets the account up for it, builds a 2-card carousel (Brain lit while it works), and closes the batch with its results");
  const { DateTime: DTB } = await import("luxon");
  const todayCT = DTB.now().setZone("America/Chicago");
  const { data: mpCampaign } = await db.from("ad_campaigns").select("id, ad_sets(meta_adset_id)").eq("agent_id", AGENT_ID).eq("topic", "mortgage_protection").single();
  const mpSet = (mpCampaign!.ad_sets as { meta_adset_id: string }[])[0].meta_adset_id;
  const endsOn = todayCT.plus({ days: 13 }).toISODate()!;
  // Spend earlier steps logged for today would count toward a batch that starts today; start it clean
  await db.from("ad_insights_daily").delete().eq("agent_id", AGENT_ID).gte("date", todayCT.toISODate()!);
  const beforeToday = (r: Record<string, unknown>) => String(r.date_start) < todayCT.toISODate()!;
  meta.insights = meta.insights.filter(beforeToday); // the simulated Meta would otherwise re-send them
  meta.placements = meta.placements.filter(beforeToday);
  const { data: batchRow, error: batchError } = await db.from("campaign_batches").insert({ agent_id: AGENT_ID, status: "active", budget_cents: 28_000, option: "focused", campaigns: ["mortgage_protection"], days: 14, daily_cents: 2000, starts_on: todayCT.toISODate(), ends_on: endsOn, reason: "e2e" }).select("id").single();
  if (batchError) throw batchError;
  await db.from("agents").update({ daily_budget_cents: 2000, campaign_started_on: todayCT.toISODate(), campaign_ends_on: endsOn, migz_mode: "auto", migz_last_run_at: null }).eq("id", AGENT_ID);
  const carousel = { concept: "The house, then the plan", topic: "mortgage_protection", style: "warm natural light, candid lifestyle", primary_text: "Who keeps paying the mortgage if you can't? A free call walks you through your options.", launch_adset_id: mpSet, title: "Built a mortgage-protection carousel", reason: "Two beats: the home, then keeping it.",
    cards: [{ scene: "A young couple on the porch of their first house, keys in hand", overlay_lines: ["The house is yours."], headline: "Your first home" }, { scene: "The same couple at their kitchen table, relaxed, evening light", overlay_lines: ["Keep it that way."], headline: "Protect it" }] };
  operatorCalls = 0;
  operatorScript = (p, call) => {
    if (call === 1) {
      const snap = snapshotOf(p);
      assert.equal(snap.campaigns.length, 1, "only the batch's campaign is in play");
      assert.match(JSON.stringify(snap.agent.batch), /focused/);
      assert.ok(p.tools!.find((t) => t.name === "generate_carousel"), "carousels offered");
      return { advisor: true, content: [...advisorBlocks(), toolUse("generate_carousel", carousel)] };
    }
    assert.match(lastToolResults(p)[0].content, /^Done/, lastToolResults(p)[0].content);
    return { content: [text("Built a carousel.")] };
  };
  const adsBeforeBatch = new Set(meta.ads.keys());
  const batchRun = await run("manual");
  assert.equal(batchRun.status, "succeeded", JSON.stringify(batchRun));
  const { data: afterBatch } = await db.from("ad_campaigns").select("topic, retired_at, status").eq("agent_id", AGENT_ID);
  assert.equal(afterBatch!.filter((c) => !c.retired_at).length, 1);
  assert.equal(afterBatch!.filter((c) => c.retired_at && c.status === "PAUSED").length, 3, "the 3 campaigns the batch doesn't use are paused and retired");
  const { data: appliedBatch } = await db.from("campaign_batches").select("applied_at").eq("id", batchRow!.id).single();
  assert.ok(appliedBatch!.applied_at);
  // Starting the batch set its whole budget aside: the balance drops by $280 right away, not as Meta spends
  const { data: setAsideRow } = await db.from("wallet_transactions").select("amount_cents, kind, description").eq("external_id", `batch:${batchRow!.id}`).single();
  assert.deepEqual([setAsideRow!.amount_cents, setAsideRow!.kind], [-28_000, "adjustment"]);
  assert.match(setAsideRow!.description, /Set aside for your \$280 campaign batch/);
  const { data: mpSetRow } = await db.from("ad_sets").select("daily_budget_cents").eq("meta_adset_id", mpSet).single();
  assert.equal(mpSetRow!.daily_budget_cents, 2000, "the batch's one campaign gets its whole $20/day");
  const { data: batchLog } = await db.from("ad_actions").select("title").eq("agent_id", AGENT_ID).eq("tool", "system_setup").order("created_at", { ascending: false }).limit(1).single();
  assert.equal(batchLog!.title, "Set up your $280 batch");
  const setupSlack = slack.filter((m) => m.channel === "U_TEST" && /campaign batch is set up/.test(m.text)).at(-1)!;
  assert.match(setupSlack.text, /Your \$280 campaign batch is set up: Mortgage protection/);
  assert.match(JSON.stringify(setupSlack.blocks), /Migz is running it automatically/, "auto mode says so");
  // Higgsfield is working on both cards: the Brain shows it with an open step, outside any review
  // (other jobs may still be generating too; this checks the carousel's own step)
  const { data: openHf } = await db.from("migz_events").select("summary").eq("agent_id", AGENT_ID).eq("tier", "higgsfield").is("finished_at", null).like("summary", "Making a carousel%");
  assert.equal(openHf!.length, 1, JSON.stringify(openHf));
  for (const rid of hf.status.keys()) hf.status.set(rid, "completed");
  await advanceOpenJobs(Date.now() + 60_000);
  const carouselAds = [...meta.ads.keys()].filter((id) => !adsBeforeBatch.has(id));
  assert.equal(carouselAds.length, 1, "one carousel ad built");
  // The agent gets a preview of the live ad in Slack: both cards, the copy and a Book now button
  const liveSlack = slack.filter((m) => m.channel === "U_TEST" && /Your new ad is with Meta for review/.test(m.text)).at(-1)!;
  assert.ok(liveSlack, "ad sent-to-Meta message sent");
  const liveBlocks = liveSlack.blocks as { type: string; image_url?: string }[];
  assert.equal(liveBlocks.filter((b) => b.type === "image").length, 2, "both carousel cards in the preview");
  assert.ok(liveBlocks.filter((b) => b.type === "image").every((b) => /^https:\/\/.+\/storage\/v1\/object\/sign\//.test(b.image_url!)), "cards are signed links Slack can load");
  assert.match(JSON.stringify(liveBlocks), /Book now/); assert.match(JSON.stringify(liveBlocks), /Who keeps paying the mortgage/);
  const lastCreative = meta.calls.filter((c) => c.method === "POST" && c.path.endsWith("/adcreatives")).at(-1)!;
  const spec = JSON.parse(String(lastCreative.body.object_story_spec)) as { link_data: { child_attachments: { name: string; image_hash: string }[] } };
  assert.deepEqual(spec.link_data.child_attachments.map((c) => c.name), ["Your first home", "Protect it"]);
  const ideogramCalls = hf.submitted.filter((x) => x.path.includes("ideogram") && x.body.aspect_ratio === "1:1");
  assert.ok(ideogramCalls.length >= 2, "each card made as a square still");
  const { data: stillOpen } = await db.from("migz_events").select("id").eq("agent_id", AGENT_ID).is("finished_at", null).gte("started_at", T0);
  assert.equal(stillOpen!.length, 0, "every step closed once the work was done");
  const { data: built } = await db.from("migz_events").select("summary").eq("agent_id", AGENT_ID).like("summary", "Carousel built in Meta%");
  assert.equal(built!.length, 1);
  // Meta was told to stop the batch's ad set itself at the end of its last day
  const endTimes = meta.calls.filter((c) => c.method === "POST" && c.path === mpSet && c.body.end_time).map((c) => String(c.body.end_time));
  assert.ok(endTimes.some((t) => t.startsWith(`${endsOn}T23:59:59`)), JSON.stringify(endTimes));
  // Spend runs ahead ($200 of $280 by day 1): Migz paces the budget down so Meta's 25% swings can't go over
  await db.from("ad_insights_daily").insert({ agent_id: AGENT_ID, meta_ad_id: carouselAds[0], date: todayCT.toISODate(), spend_cents: 20_000, impressions: 1000, clicks: 10 });
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  operatorScript = (p) => {
    assert.match(JSON.stringify(p.messages), /batch_pacing/);
    return { content: [text("Held.")] };
  };
  assert.equal((await run("manual")).status, "succeeded");
  const { data: pacedSet } = await db.from("ad_sets").select("daily_budget_cents").eq("meta_adset_id", mpSet).single();
  assert.equal(pacedSet!.daily_budget_cents, Math.floor(8000 / 14), "$80 left over 14 days: $5.71/day");
  const { data: paceLog } = await db.from("ad_actions").select("title, detail").eq("agent_id", AGENT_ID).eq("tool", "system_pace").order("created_at", { ascending: false }).limit(1).single();
  assert.equal(paceLog!.title, "Paced your batch to stay within $280.00"); assert.match(paceLog!.detail, /25% over/);
  // Spend reaches the budget: ads pause early rather than go over, with no model call
  await db.from("ad_insights_daily").update({ spend_cents: 27_800 }).eq("meta_ad_id", carouselAds[0]).eq("date", todayCT.toISODate());
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  modelAllowed = false;
  assert.equal((await run("manual")).status, "paused");
  modelAllowed = true;
  const { data: usedLog } = await db.from("ad_actions").select("title").eq("agent_id", AGENT_ID).eq("tool", "system_pause").order("created_at", { ascending: false }).limit(1).single();
  assert.equal(usedLog!.title, "Your batch budget is used up");

  // The batch's last day passes: ads pause and the batch is closed with what it did
  const yesterday = todayCT.minus({ days: 1 }).toISODate()!;
  await db.from("campaign_batches").update({ ends_on: yesterday }).eq("id", batchRow!.id);
  await db.from("agents").update({ campaign_ends_on: yesterday, migz_last_run_at: null }).eq("id", AGENT_ID);
  modelAllowed = false;
  const endRun = await run("manual");
  modelAllowed = true;
  assert.equal(endRun.status, "paused");
  const { data: endedBatch } = await db.from("campaign_batches").select("status, result").eq("id", batchRow!.id).single();
  assert.equal(endedBatch!.status, "ended"); assert.ok(endedBatch!.result && typeof (endedBatch!.result as { spent_cents: number }).spent_cents === "number");
  // What it didn't spend came back to the balance ($280 budget, $278 spent: $2 back), exactly once
  const spentInBatch = (endedBatch!.result as { spent_cents: number }).spent_cents;
  const { data: returned } = await db.from("wallet_transactions").select("amount_cents, kind").eq("external_id", `batch:${batchRow!.id}:return`);
  assert.equal(returned!.length, 1);
  assert.deepEqual([returned![0].amount_cents, returned![0].kind], [28_000 - spentInBatch, "refund"]);
  const { count: dailySpendRows } = await db.from("wallet_transactions").select("id", { count: "exact", head: true }).eq("agent_id", AGENT_ID).eq("kind", "ad_spend");
  assert.equal(dailySpendRows, 0, "daily Meta spend is no longer taken from the balance on top of the set-aside");
  await db.from("agents").update({ campaign_ends_on: null, campaign_started_on: null, migz_last_run_at: null }).eq("id", AGENT_ID);
  ok("batch applied (1 campaign kept at $20/day, 3 retired, Meta end time set), 2-card carousel built with live Brain steps, spend paced down then paused at the budget, batch closed with results");

  // ===== 8h =====
  step("8h. The agent changes their licensed states: ads re-target in Meta right away; with no states left, ads pause");
  const { retargetNow } = await import("@/lib/migz/agent");
  const { data: setsInPlay } = await db.from("ad_sets").select("meta_adset_id, ad_campaigns!inner(retired_at)").eq("agent_id", AGENT_ID).is("ad_campaigns.retired_at", null);
  const callsBefore = meta.calls.length;
  await db.from("agents").update({ licensed_states: ["FL", "TX"] }).eq("id", AGENT_ID);
  const retargeted = await retargetNow((await getAgent()) as never);
  assert.equal(retargeted, setsInPlay!.length, "every ad set in play was re-targeted");
  const targetingPosts = meta.calls.slice(callsBefore).filter((c) => c.method === "POST" && /^adset_\d+$/.test(c.path) && c.body.targeting);
  assert.ok(targetingPosts.length >= 1);
  const regions = (JSON.parse(String(targetingPosts.at(-1)!.body.targeting)) as { geo_locations: { regions: { key: string }[] } }).geo_locations.regions.map((r) => r.key).sort();
  assert.deepEqual(regions, ["region_Florida", "region_Texas"]);
  const { data: logged } = await db.from("ad_actions").select("title").eq("agent_id", AGENT_ID).eq("tool", "system_targeting").order("created_at", { ascending: false }).limit(1).single();
  assert.equal(logged!.title, "Updated your ads to your licensed states");
  assert.equal(await retargetNow((await getAgent()) as never), 0, "already matching: nothing to do");
  await db.from("ad_sets").update({ status: "ACTIVE" }).eq("agent_id", AGENT_ID);
  await db.from("agents").update({ licensed_states: [] }).eq("id", AGENT_ID);
  assert.ok(((await retargetNow((await getAgent()) as never)) ?? 0) > 0);
  const { count: stillLive } = await db.from("ad_sets").select("id", { count: "exact", head: true }).eq("agent_id", AGENT_ID).eq("status", "ACTIVE");
  assert.equal(stillLive, 0, "no licensed states = no ads running");
  await db.from("agents").update({ licensed_states: ["FL", "GA", "TX"], migz_last_run_at: null }).eq("id", AGENT_ID);
  ok("new states pushed to Meta immediately (FL, TX); removing every state paused all ads");

  // ===== 8i =====
  step("8i. Two processes advance the same creative job at once (webhook + cron): one ad, not two");
  const { data: dupSet } = await db.from("ad_sets").select("meta_adset_id").eq("agent_id", AGENT_ID).limit(1).single(); // (8h left them paused; the launcher doesn't need one active)
  const { data: dupCreative } = await db.from("creatives").insert({ agent_id: AGENT_ID, kind: "image", storage_path: `${AGENT_ID}/migz/dup-${Date.now()}.png`, file_name: "Migz · duplicate guard", mime_type: "image/png", size_bytes: PNG.length, status: "in_review", source: "migz", hook: "dup" }).select("id, storage_path").single();
  await db.storage.from("creatives").upload(dupCreative!.storage_path, PNG, { contentType: "image/png" });
  const { data: dupJob } = await db.from("creative_jobs").insert({ agent_id: AGENT_ID, stage: "stored", creative_id: dupCreative!.id, launch_adset_id: dupSet!.meta_adset_id, brief: { format: "image", concept: "dup", scene: "s", style: "s", overlay_lines: ["One ad only."], button_text: null, aspect_ratio: "4:5", primary_text: "A free call walks you through it.", headline: "One ad" } }).select("id").single();
  const adsBeforeDup = [...meta.ads.keys()].length;
  const raced = await Promise.all([advanceJobById(dupJob!.id), advanceJobById(dupJob!.id), advanceJobById(dupJob!.id)]);
  assert.equal(raced.filter((r) => r === "launched").length, 1, JSON.stringify(raced));
  assert.ok(raced.filter((r) => r === "busy").length >= 1, `the others stepped aside: ${JSON.stringify(raced)}`);
  assert.equal([...meta.ads.keys()].length - adsBeforeDup, 1, "exactly one ad was built");
  const { count: dupAds } = await db.from("ads").select("id", { count: "exact", head: true }).eq("agent_id", AGENT_ID).eq("creative_id", dupCreative!.id);
  assert.equal(dupAds, 1);
  const { data: released } = await db.from("creative_jobs").select("claimed_at").eq("id", dupJob!.id).single();
  assert.equal(released!.claimed_at, null, "the claim is released when the run ends");
  ok("three simultaneous advances of one job: one launched it, the others stepped aside, one ad exists, claim released");

  // ===== 8j =====
  step("8j. Facebook vs Instagram: ads carry the placement, bookings are split by platform, and Migz sees which books cheaper");
  const creativesPosted = meta.calls.filter((c) => c.method === "POST" && c.path.endsWith("/adcreatives"));
  assert.ok(creativesPosted.length && creativesPosted.every((c) => String(c.body.url_tags).includes("utm_term={{placement}}")), "every ad link carries Meta's placement macro");
  const platformAd = carouselAds[0];
  const todayPl = DTB.now().setZone("America/Chicago").toISODate()!;
  await db.from("ad_placement_daily").insert([
    { agent_id: AGENT_ID, meta_ad_id: platformAd, date: todayPl, publisher_platform: "facebook", platform_position: "feed", spend_cents: 10_000, impressions: 5000, link_clicks: 40 },
    { agent_id: AGENT_ID, meta_ad_id: platformAd, date: todayPl, publisher_platform: "instagram", platform_position: "instagram_reels", spend_cents: 10_000, impressions: 6000, link_clicks: 70 },
  ]);
  const terms = [...Array(8).fill("Instagram_Reels"), "Facebook_Mobile_Feed", null];
  for (const [i, term] of terms.entries()) {
    const at = new Date(Date.now() + (3 + i) * 86_400_000);
    const { data: b } = await db.from("bookings").insert({ agent_id: AGENT_ID, starts_at: at.toISOString(), ends_at: new Date(at.getTime() + 1_800_000).toISOString(), name: "E2E Platform", email: "e2e-platform@example.com", phone: "+15555550113", consent_text: "test", attribution: { utm_source: "meta", utm_content: platformAd, ...(term ? { utm_term: term } : {}) } }).select("id").single();
    testBookingIds.push(b!.id);
  }
  const snapPl = await buildSnapshot((await getAgent()) as never);
  const setWithAd = snapPl.forModel.campaigns.flatMap((c) => c.ad_sets).find((x) => (x.ads as { ad_id: string }[]).some((a) => a.ad_id === platformAd))!;
  const byPlatform = setWithAd.results_by_platform_last_14_days as { instagram: { booked_calls: number; cost_per_booked_call: string }; facebook: { booked_calls: number; cost_per_booked_call: string }; booked_calls_without_a_placement?: number; focus: string };
  assert.deepEqual([byPlatform.instagram.booked_calls, byPlatform.instagram.cost_per_booked_call], [8, "$12.50"]);
  assert.deepEqual([byPlatform.facebook.booked_calls, byPlatform.facebook.cost_per_booked_call], [1, "$100.00"]);
  assert.equal(byPlatform.booked_calls_without_a_placement, 1, "a booking from an older link is counted as untracked, not guessed");
  assert.match(byPlatform.focus, /instagram books calls clearly cheaper/);
  assert.equal((snapPl.forModel.platform_split_last_14_days as { instagram: { booked_calls: number } }).instagram.booked_calls, 8);
  const ctxPl = await buildEvalContext((await getAgent()) as never, snapPl);
  const guardSet = ctxPl.adsets.find((x) => x.meta_adset_id === setWithAd.adset_id)!;
  const { checkPlatformFocus: focusCheck } = await import("@/lib/migz/platforms");
  assert.equal(focusCheck(guardSet.platforms, ["instagram_feed", "instagram_reels", "instagram_stories"]), null, "the guardrail sees the same numbers and allows an Instagram focus");
  assert.match(focusCheck(guardSet.platforms, ["facebook_feed", "facebook_reels"]) ?? "", /Not enough evidence to drop instagram/, "but not a Facebook focus");
  ok("ad links carry the placement; 8 Instagram vs 1 Facebook booking at $12.50 vs $100 each; Migz and the guardrail both see Instagram as the cheaper platform");

  // ===== 9 =====
  step("9. Slack: morning digest section, and failure alerts to staff (once per distinct error)");
  const { migzDigestSection } = await import("@/lib/migz/slack");
  agent = await getAgent();
  const section = await migzDigestSection(agent as never, DateTime.now().setZone("America/Chicago").plus({ days: 1 }));
  assert.match(section, /Your ads yesterday/); assert.match(section, /What Migz did/); assert.match(section, /Paused the image ad/);
  assert.match(section, /spent/);
  ok("digest section: yesterday's spend and results, what Migz did (including the pause), nothing invented");

  slack.length = 0;
  await db.from("agents").update({ migz_last_run_at: null }).eq("id", AGENT_ID);
  const broken = async () => { throw new Error("400 invalid_request_error: simulated outage"); };
  const failRun = () => getAgent().then((a) => runMigz(a as never, { trigger: "manual", createMessage: broken as never }));
  const f1 = await failRun();
  assert.equal(f1.status, "failed");
  const adminMsgs = () => slack.filter((m) => m.channel === "U_ADMIN");
  assert.equal(adminMsgs().length, 1); assert.match(adminMsgs()[0].text, /Migz review failed/); assert.match(adminMsgs()[0].text, /simulated outage/); assert.match(adminMsgs()[0].text, new RegExp(SLUG));
  const f2 = await failRun();
  assert.equal(f2.status, "failed");
  assert.equal(adminMsgs().length, 1, "same error within 6h does not alert again");
  const failRun3 = () => getAgent().then((a) => runMigz(a as never, { trigger: "manual", createMessage: (async () => { throw new Error("401 authentication_error: different"); }) as never }));
  await failRun3();
  assert.equal(adminMsgs().length, 2, "a different error alerts");
  // (real updates, like campaigns built before the model call failed, still reach them)
  const toAgentNow = slack.filter((m) => m.channel === "U_TEST").map((m) => m.text);
  assert.ok(!toAgentNow.some((t) => /fail|outage|error|authentication/i.test(t)), `the agent isn't paged about our outages: ${JSON.stringify(toAgentNow)}`);
  ok("review failure alerts staff once per distinct error and never pages the agent");

  console.log("\nALL BRAIN E2E STEPS PASSED");
} catch (e) {
  failed = true;
  console.error("\nE2E FAILED:", e);
} finally {
  console.log("\n▶ Cleanup");
  const { data: runs } = await db.from("migz_runs").select("id").eq("agent_id", AGENT_ID);
  const runIds = (runs ?? []).map((r) => r.id);
  if (runIds.length) await db.from("model_calls").delete().in("run_id", runIds); // includes shared scout calls (agent_id null)
  await db.from("swipe_files").delete().is("agent_id", null).eq("added_by", "scout").gte("created_at", T0); // only this run's rows
  const { data: files } = await db.from("creatives").select("storage_path").eq("agent_id", AGENT_ID);
  if (files?.length) await db.storage.from("creatives").remove(files.map((c) => c.storage_path));
  await db.from("ad_insights_daily").delete().eq("agent_id", AGENT_ID);
  await db.from("agents").delete().eq("id", AGENT_ID); // cascades every row that belongs to the test agent
  const { count: left } = await db.from("agents").select("id", { count: "exact", head: true }).eq("id", AGENT_ID);
  console.log(`  test agent ${SLUG} removed (${left ?? 0} left)`);
  console.log("  done");
  process.exit(failed ? 1 : 0);
}
