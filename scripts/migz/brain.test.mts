import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://x.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "x";
(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { planTier } = await import("@/lib/migz/router");
const { materialChanges, gateState } = await import("@/lib/migz/gate");
const { ladder, frameTimes, extractFrames } = await import("@/lib/migz/vision");
const { progress, allReady } = await import("@/lib/migz/experiments");
const { checkNotCopied } = await import("@/lib/migz/guardrails");
const { advisedToolUses, affectsSpend } = await import("@/lib/migz/operator");
const { fatigue, derive, emptyTotals, addRow } = await import("@/lib/migz/metrics");
const { costUsd } = await import("@/lib/migz/models");
const { parseExamples } = await import("@/lib/migz/team/scout");
const { keywords } = await import("@/lib/migz/team/librarian");
const { routinesDue } = await import("@/lib/migz/routines");
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };

// router tiers + degrade
const b = (ratio: number) => ({ limitUsd: 30, spentUsd: ratio * 30, ratio });
assert.deepEqual(planTier("operator", b(0.5)), { tier: "sonnet", degraded: false });
assert.deepEqual(planTier("audit", b(0.5)), { tier: "haiku", degraded: false });
assert.deepEqual(planTier("memo", b(0.2)), { tier: "opus", degraded: false });
assert.equal(planTier("scout", b(0.85)), null);
assert.deepEqual(planTier("watch", b(0.5)), { tier: "sonnet", degraded: false }, "live check-in notes are written by Sonnet");
assert.equal(planTier("watch", b(0.85)), null, "and stop near the model budget, like the scout");
assert.deepEqual(planTier("operator", b(1.2)), { tier: "haiku", degraded: true });
assert.deepEqual(planTier("memo", b(1.2)), { tier: "sonnet", degraded: true });
assert.deepEqual(planTier("creative_traits", b(1)), { tier: "haiku", degraded: true });
ok("task → tier routing, scout stops at 80%, Sonnet→Haiku and Opus→Sonnet at 100%");
assert.ok(Math.abs(costUsd("claude-opus-5-5", { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 }) - 6) < 1e-9);
assert.ok(Math.abs(costUsd("claude-haiku-5-5", { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }) - 0.61) < 1e-9);
ok("cost estimates from list prices (Opus $4/$20, Haiku $0.10/$0.50, cache reads)");

// metrics + fatigue
const t14 = emptyTotals(); const t3 = emptyTotals();
for (let i = 0; i < 14; i++) addRow(t14, { meta_ad_id: "a", date: `d${i}`, spend_cents: 500, impressions: 1000, clicks: 20, link_clicks: 15, reach: 500, video_3s_views: 300, thruplays: 90, video_plays: 400, avg_watch_ms: 6000, video_p25: 200, video_p50: 150, video_p75: 110, video_p100: 80 });
for (let i = 0; i < 3; i++) addRow(t3, { meta_ad_id: "a", date: `d${i}`, spend_cents: 500, impressions: 1000, clicks: 8, link_clicks: 6, reach: 280, video_3s_views: 180, thruplays: 50, video_plays: 300 });
const d14 = derive(t14), d3 = derive(t3);
assert.equal(d14.hook_rate, 0.3); assert.equal(d14.hold_rate, 0.3); assert.equal(d14.frequency, 2);
assert.equal(d14.retention!.p25, 200 / 300);
const f = fatigue(d14, d3);
assert.ok(f.score > 0.3 && f.signals.length === 3, JSON.stringify(f));
ok("hook rate, hold rate, retention, frequency; fatigue from frequency + CTR + hook-rate decay");

// ladder
const avg = { hook_rate: 0.3, hold_rate: 0.3, link_ctr: 0.015, visit_to_booking: 0.1, frequency: 2 };
const ad = (o: object) => ({ hook_rate: 0.3, hold_rate: 0.3, link_ctr: 0.015, visit_to_booking: 0.1, frequency: 2, impressions: 3000, visits: 50, ...o });
assert.equal(ladder(ad({ impressions: 500 }), avg, []).rung, "too_early");
assert.equal(ladder(ad({ hook_rate: 0.15 }), avg, []).rung, "hook");
assert.equal(ladder(ad({ hold_rate: 0.1 }), avg, []).rung, "body");
assert.equal(ladder(ad({ link_ctr: 0.005 }), avg, []).rung, "copy");
assert.equal(ladder(ad({ visit_to_booking: 0.02 }), avg, []).rung, "landing");
assert.equal(ladder(ad({}), avg, ["frequency 4.0"]).rung, "fatigue");
assert.equal(ladder(ad({}), avg, []).rung, "healthy");
ok("diagnosis ladder against the ad set's own averages: hook → body → copy → landing, fatigue, too early");

// experiments: never end early
const metrics = new Map([
  ["v1", { t: { d14: { ...emptyTotals(), impressions: 1600, thruplays: 120 } } }],
  ["v2", { t: { d14: { ...emptyTotals(), impressions: 900, thruplays: 60 } } }],
]) as never;
const exp = { variants: [{ label: "A", ad_id: "v1", creative_job_id: null }, { label: "B", ad_id: "v2", creative_job_id: null }], min_impressions: 1500, min_thruplays: 0 };
assert.equal(allReady(progress(exp, metrics)), false);
(metrics as Map<string, { t: { d14: { impressions: number } } }>).get("v2")!.t.d14.impressions = 1500;
assert.equal(allReady(progress(exp, metrics)), true);
assert.equal(allReady(progress({ ...exp, min_thruplays: 100 }, metrics)), false);
assert.equal(allReady(progress({ ...exp, variants: [exp.variants[0], { label: "C", ad_id: null, creative_job_id: "j" }] }, metrics)), false);
ok("experiment verdict only when every variant has its impressions and ThruPlays (and exists)");

// copy lifting
const swipe = ["Big Insurer runs: Your family deserves a plan that protects them no matter what happens tomorrow."];
assert.match(checkNotCopied(["Your family deserves a plan that protects them, call today"], swipe)!, /lifted/);
assert.equal(checkNotCopied(["Your work policy ends when your job does."], swipe), null);
ok("copy that lifts 6+ words from the swipe file is refused");

// advisor ordering
const content = [
  { type: "tool_use", id: "t1", name: "pause_ad", input: {} },
  { type: "server_tool_use", id: "s1", name: "advisor", input: {} },
  { type: "advisor_tool_result", tool_use_id: "s1", content: { type: "advisor_redacted_result", encrypted_content: "xx", stop_reason: "end_turn" } },
  { type: "tool_use", id: "t2", name: "pause_ad", input: {} },
] as never;
const adv = advisedToolUses(content, false);
assert.equal(adv.advised, true); assert.ok(!adv.advisedIds.has("t1")); assert.ok(adv.advisedIds.has("t2")); assert.equal(adv.consultations.length, 1);
const err = advisedToolUses([{ type: "advisor_tool_result", tool_use_id: "s", content: { type: "advisor_tool_result_error", error_code: "overloaded" } }, { type: "tool_use", id: "t3", name: "x", input: {} }] as never, false);
assert.equal(err.advised, false);
assert.ok(advisedToolUses([{ type: "tool_use", id: "t4", name: "x", input: {} }] as never, true).advisedIds.has("t4"));
assert.equal(affectsSpend({ tool: "hold" }), false);
assert.equal(affectsSpend({ tool: "generate_image", launch_adset_id: null } as never), false);
assert.equal(affectsSpend({ tool: "generate_image", launch_adset_id: "A" } as never), true);
assert.equal(affectsSpend({ tool: "pause_ad", ad_id: "x" }), true);
ok("only tool calls after a successful (encrypted) advisor result count as advised; errors don't");

// gate
const snap = (impr: number, book: number, status = "ACTIVE") => ({
  adMetrics: new Map([["a", { t: { d14: { ...emptyTotals(), impressions: impr, booked_calls: book, spend_cents: 100 } } }]]),
  guardAdsets: [{ meta_adset_id: "A", status: "ACTIVE", daily_budget_cents: 2000, ads: [{ meta_ad_id: "a", status }] }],
  forModel: { creatives_not_running: [] }, openGenerations: 0, focus: [],
}) as never;
const prev = gateState(snap(5000, 2));
const base = { trigger: "schedule" as const, previous: prev, lastOperatorAt: new Date(Date.now() - 3 * 3600_000).toISOString(), auditMaterial: false, experimentsReady: 0, routinesDue: [] };
assert.deepEqual(materialChanges({ ...base, snapshot: snap(5600, 2) }), []);
assert.match(materialChanges({ ...base, snapshot: snap(5600, 3) }).join(), /new booked call/);
assert.match(materialChanges({ ...base, snapshot: snap(6200, 2) }).join(), /new impressions/);
assert.match(materialChanges({ ...base, snapshot: snap(5000, 2, "DISAPPROVED") }).join(), /status changed/);
assert.match(materialChanges({ ...base, trigger: "manual", snapshot: snap(5000, 2) }).join(), /requested/);
assert.match(materialChanges({ ...base, lastOperatorAt: new Date(Date.now() - 30 * 3600_000).toISOString(), snapshot: snap(5000, 2) }).join(), /daily check/);
assert.match(materialChanges({ ...base, auditMaterial: true, snapshot: snap(5000, 2) }).join(), /audit/);
const focused = (focus: string) => ({ ...(snap(5000, 2) as object), focus: focus ? focus.split(",") : [] }) as never;
assert.deepEqual(materialChanges({ ...base, previous: gateState(focused("final_expense")), snapshot: focused("final_expense") }), []);
assert.match(materialChanges({ ...base, previous: gateState(focused("final_expense")), snapshot: focused("mortgage_protection,final_expense") }).join(), /ad focus/);
// Spend and account size: a day's budget of new spend counts; the impressions bar scales with the account
const { impressionsThreshold } = await import("@/lib/migz/gate");
assert.equal(impressionsThreshold(1956, 2544, 1487), 572, "Miguel: a day's budget buys ~1,143 impressions, so 572 count");
assert.equal(impressionsThreshold(100_000, 50_000, 900_000), 1000, "big accounts top out at 1,000");
assert.equal(impressionsThreshold(500, 10_000, 4000), 250, "tiny accounts still need 250");
assert.equal(impressionsThreshold(2000, 0, 0), 1000, "no data yet: the old 1,000");
const spendSnap = (impr: number, spend: number) => ({
  adMetrics: new Map([["a", { t: { d14: { ...emptyTotals(), impressions: impr, booked_calls: 0, spend_cents: spend } } }]]),
  guardAdsets: [{ meta_adset_id: "A", status: "ACTIVE", daily_budget_cents: 978, ads: [{ meta_ad_id: "a", status: "ACTIVE" }] }, { meta_adset_id: "B", status: "ACTIVE", daily_budget_cents: 978, ads: [] }],
  forModel: { creatives_not_running: [] }, openGenerations: 0, focus: [],
}) as never;
const spendBase = { ...base, previous: gateState(spendSnap(786, 594)) };
assert.match(materialChanges({ ...spendBase, snapshot: spendSnap(1487, 2544) }).join(), /701 new impressions/, "Miguel's skipped review would now run (701 over his 572)");
assert.match(materialChanges({ ...spendBase, snapshot: spendSnap(900, 2600) }).join(), /\$20\.06 new spend/, "a day's budget of spend counts even with few impressions");
assert.deepEqual(materialChanges({ ...spendBase, snapshot: spendSnap(1000, 1200) }), [], "under both bars: still quiet");
ok("quiet gate: skips small changes; runs on bookings, new impressions (scaled to the account), a day's budget of spend, status changes, manual, daily, audit");

// routines cadence
const now = new Date("2026-10-20T12:00:00Z");
assert.deepEqual(routinesDue({ migz_last_daily_at: "2026-10-20T00:00:00Z", migz_last_fatigue_at: "2026-10-18T00:00:00Z", migz_last_weekly_at: "2026-10-10T00:00:00Z" }, now), { daily: false, fatigue: false, weekly: true });
assert.deepEqual(routinesDue({ migz_last_daily_at: null, migz_last_fatigue_at: "2026-10-16T00:00:00Z", migz_last_weekly_at: "2026-10-19T00:00:00Z" }, now), { daily: true, fatigue: true, weekly: false });
ok("routine cadence: daily, every 3.5 days, weekly");

// scout + librarian parsing
assert.equal(parseExamples('notes <examples>{"examples":[{"source_url":"https://x","advertiser":"X","notes":"n","traits":{"angle":"a","hook_type":"q","opening_image":"o","emotional_tone":"t","setting":"s","text_legibility":"l","claims":[],"compliance_risk":"low","format":"video","offer":"call"}}]}</examples>').length, 1);
assert.equal(parseExamples("no tags").length, 0);
assert.deepEqual(keywords("Did a final expense hook ever lose?"), ["did", "final", "expense", "hook", "lose"]);
ok("scout example parsing and librarian keywords");

// strict tool budget: Anthropic rejects the request when too many strict schemas are compiled together
const { MIGZ_TOOLS: coreTools, MAX_STRICT_TOOLS } = await import("@/lib/migz/tools");
const { EXPERIMENT_TOOLS: expTools } = await import("@/lib/migz/experiments");
const { READ_TOOLS: readTools } = await import("@/lib/migz/team/tools");
const { diagnoseCreativeTool: diagTool } = await import("@/lib/migz/vision");
const everyTool = [...coreTools, ...[...readTools, ...expTools, diagTool].map((t) => t.def)];
const strictN = everyTool.filter((t) => (t as { strict?: boolean }).strict).length;
assert.ok(strictN <= MAX_STRICT_TOOLS, `${strictN} strict tools; the API rejects too many`);
assert.equal(new Set(everyTool.map((t) => t.name)).size, everyTool.length, "tool names are unique");
ok(`${everyTool.length} tools offered, ${strictN} strict (limit ${MAX_STRICT_TOOLS}); names unique`);

// launch targets: a paused ad set is refused, except in test mode where ads are built paused
const { checkLaunchTarget } = await import("@/lib/migz/guardrails");
const pausedCtx = (o: object) => ({ now: new Date(), dailyCapCents: 3000, actionsThisRun: 0, generationsThisRun: 0, openGenerations: 0, adsets: [{ meta_adset_id: "A", status: "PAUSED", daily_budget_cents: 2000, learning_status: null, last_edited_at: "2026-10-01T00:00:00Z", ads: [] }], ...o });
assert.match(checkLaunchTarget(pausedCtx({}), "A")!, /PAUSED/);
assert.equal(checkLaunchTarget(pausedCtx({ adsets: [{ ...pausedCtx({}).adsets[0], status: "ACTIVE" }] }), "A"), null);
assert.equal(checkLaunchTarget(pausedCtx({ testMode: true }), "A"), null);
assert.match(checkLaunchTarget(pausedCtx({ testMode: true, adsets: [{ ...pausedCtx({}).adsets[0], status: "DELETED" }] }), "A")!, /DELETED/);
ok("launch targets: a paused ad set is refused, except in test mode");

// campaign plan helpers
const { endDate, campaignEnded, daysLeft, estimate, DURATIONS } = await import("@/lib/campaign");
const { DateTime: DT } = await import("luxon");
assert.equal(endDate("2026-10-21", 30), "2026-11-19"); // the start day counts as day 1
assert.equal(endDate("2026-10-21", 1), "2026-10-21");
assert.equal(endDate("2026-10-21", 0), null); assert.equal(endDate("2026-10-21", null), null);
const noon = DT.fromISO("2026-11-19T18:00:00Z");
assert.equal(campaignEnded("2026-11-19", "America/Chicago", noon), false, "the last day still runs");
assert.equal(campaignEnded("2026-11-18", "America/Chicago", noon), true);
assert.equal(campaignEnded(null, "America/Chicago", noon), false);
assert.equal(campaignEnded("2026-11-19", "America/Los_Angeles", DT.fromISO("2026-11-20T07:30:00Z")), false, "timezone of the agent, not the server");
assert.equal(daysLeft("2026-11-21", "America/Chicago", noon), 3);
assert.equal(daysLeft("2026-11-18", "America/Chicago", noon), 0);
const est = estimate(2000, 30, 45_000);
assert.deepEqual([est.totalCents, est.coveredDays, est.fullyFunded, est.shortfallCents], [60_000, 22, false, 15_000]);
assert.deepEqual([estimate(2000, 0, 5000).totalCents, estimate(2000, 14, 28_000).fullyFunded], [null, true]);
assert.ok(DURATIONS.some((d) => d.days === 0), "ongoing is offered");
ok("campaign plan: end date, end check in the agent's timezone, days left, cost estimate");

// creative caps: 3 per review, but only 1 video
const { checkGeneration } = await import("@/lib/migz/guardrails");
const gc = (o: object) => ({ now: new Date(), dailyCapCents: 3000, adsets: [], actionsThisRun: 0, generationsThisRun: 0, openGenerations: 0, ...o });
assert.equal(checkGeneration(gc({}), "video"), null);
assert.match(checkGeneration(gc({ videosThisRun: 1, generationsThisRun: 1 }), "video")!, /1 video this review/);
assert.equal(checkGeneration(gc({ videosThisRun: 1, generationsThisRun: 1 }), "image"), null);
assert.equal(checkGeneration(gc({ videosThisRun: 1, generationsThisRun: 2 }), "image"), null);
assert.match(checkGeneration(gc({ videosThisRun: 1, generationsThisRun: 3 }), "image")!, /3 creatives/);
assert.match(checkGeneration(gc({ generationsThisRun: 1, maxGenerations: 1 }), "image")!, /credits are being checked/);
assert.equal(checkGeneration(gc({ generationsThisRun: 0, maxGenerations: 1 }), "image"), null);
ok("creative caps: 3 per review, 1 video, images fill the rest; 1 while credits are being re-checked");

// topics
const { cleanFocus } = await import("@/lib/migz/topics");
assert.deepEqual(cleanFocus(["final_expense", "bogus", "final_expense", "term_life", "policy_review", "whole_life"]), ["final_expense", "term_life", "policy_review"]);
assert.deepEqual(cleanFocus(null), []);
ok("ad focus: known topics only, no repeats, at most 3, order kept");

// Higgsfield model routing for stills
process.env.HF_API_KEY_ID = "x"; process.env.HF_API_KEY_SECRET = "y";
const { imageRequest } = await import("@/lib/higgsfield");
const { evaluate: evalTool } = await import("@/lib/migz/tools");
const img = { format: "image" as const, concept: "c", scene: "A mother on a porch swing", style: "golden hour", overlay_lines: ["Protect their peace."], button_text: "Book a free call", aspect_ratio: "4:5" as const, primary_text: "p", headline: "h" };
const feed = imageRequest(img);
assert.equal(feed.path, "/ideogram/v4.0"); assert.equal(feed.body.aspect_ratio, "4:5"); assert.match(String(feed.body.prompt), /"Protect their peace\."/); assert.equal(feed.body.rendering_speed, "QUALITY");
const story = imageRequest({ ...img, aspect_ratio: "9:16" });
assert.equal(story.path, "/ideogram/v4.0"); assert.equal(story.model, "ideogram");
assert.equal(story.body.aspect_ratio, "9:16"); assert.match(String(story.body.prompt), /9:16 vertical/); assert.match(String(story.body.prompt), /"Protect their peace\."/);
const gctx = { now: new Date("2026-10-20T12:00:00Z"), dailyCapCents: 3000, actionsThisRun: 0, generationsThisRun: 0, openGenerations: 0, adsets: [{ meta_adset_id: "A", status: "ACTIVE", daily_budget_cents: 2000, learning_status: "SUCCESS", last_edited_at: "2026-10-01T00:00:00Z", ads: [] }], scriptedAds: new Map(), libraryCreativeIds: new Set<string>() };
const imgBase = { concept: "c", scene: "s", style: "st", primary_text: "Protect your family today.", headline: "Book a free call", launch_adset_id: null, title: "t", reason: "r" };
assert.equal(evalTool("generate_image", { ...imgBase, overlay_lines: ["Protect their peace."], button_text: null, aspect_ratio: "4:5" }, gctx).ok, true);
assert.equal(evalTool("generate_image", { ...imgBase, overlay_lines: ["Your work policy ends with the job."], button_text: "Book a free call", aspect_ratio: "9:16" }, gctx).ok, true);
const bad = evalTool("generate_image", { ...imgBase, overlay_lines: [], button_text: null, aspect_ratio: "9:16" }, gctx);
assert.ok(!bad.ok && /Every image carries its message/.test((bad as { error: string }).error), "a 9:16 image with no words is refused");
assert.equal(evalTool("generate_image", { ...imgBase, overlay_lines: [], button_text: null, aspect_ratio: "4:5" }, gctx).ok, false, "4:5 still needs its text lines");
process.env.HF_FEED_IMAGE_PATH = "/some/nano-banana-lite"; process.env.HF_FEED_IMAGE_BODY = '{"resolution":"1k"}';
const swapped = imageRequest(img);
assert.equal(swapped.path, "/some/nano-banana-lite"); assert.equal(swapped.model, "feed_other");
assert.deepEqual([swapped.body.aspect_ratio, swapped.body.resolution, "rendering_speed" in swapped.body], ["4:5", "1k", false]);
delete process.env.HF_FEED_IMAGE_PATH; delete process.env.HF_FEED_IMAGE_BODY;
ok("every still (4:5 and 9:16) goes to the text model (swappable by env) with its lines on it; an image with no words is refused");

// frames
assert.deepEqual(frameTimes(15), [0, 1, 2, 3, 6, 9, 12]);
assert.deepEqual(frameTimes(2), [0, 1]);
const ff = (await import("ffmpeg-static")).default as unknown as string;
const tmp = `${process.env.TMPDIR ?? "/tmp"}/migz-test.mp4`;
execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=10:size=320x568:rate=24", "-pix_fmt", "yuv420p", "-y", tmp]);
const frames = await extractFrames((await import("node:fs")).readFileSync(tmp), 10);
assert.deepEqual(frames!.map((x) => x.t), [0, 1, 2, 3, 6, 9]);
assert.ok(frames!.every((x) => x.jpeg[0] === 0xff && x.jpeg[1] === 0xd8));
ok("real ffmpeg pulls JPEG frames at 0/1/2/3s then every 3s from a 10s clip");

// campaign plan + funds
const { planTopic, campaignLabels, pickCarryOver, perCampaignCents, adSpendCents, depositFor, MIN_DEPOSIT_CENTS, MIN_AD_BALANCE_CENTS, MIN_DAILY_CENTS, TEST_DAYS } = await import("@/lib/campaign");
const three = ["final_expense", "mortgage_protection", "income_protection"] as const;
assert.equal(planTopic(["final_expense"]), "final_expense", "one focus: the campaign serves it");
assert.equal(planTopic([...three]), null, "several: one campaign with ads on each");
assert.equal(planTopic([]), null);
assert.deepEqual(campaignLabels([null], [...three]), ["Final expense + Mortgage protection + Income protection"]);
assert.deepEqual(campaignLabels([null]), ["Booked calls"], "no focus at all");
assert.deepEqual(campaignLabels(["final_expense", "mortgage_protection", "final_expense"]), ["Final expense A", "Mortgage protection", "Final expense B"], "older batches with two on one topic");
assert.equal(perCampaignCents(2500, 2), 1250);
assert.equal(adSpendCents(MIN_DEPOSIT_CENTS), 28_000); assert.equal(MIN_AD_BALANCE_CENTS, 28_000);
const { MIN_TOP_UP_CENTS } = await import("@/lib/campaign");
assert.equal(MIN_TOP_UP_CENTS, 100, "a top-up can be $1 or more");
assert.ok(MIN_TOP_UP_CENTS < MIN_DEPOSIT_CENTS, "funds add up, so a top-up needn't cover a whole batch");
assert.equal(MIN_AD_BALANCE_CENTS, 28_000, "a batch still needs $280 of ads, however it was topped up");
assert.equal(MIN_DAILY_CENTS * TEST_DAYS, MIN_AD_BALANCE_CENTS, "the minimum deposit funds $20/day for two weeks");
assert.equal(depositFor(28_000), 35_000); assert.equal(depositFor(42_000), 52_500);
const cand = (id: string, creative: string | null, topic: string | null) => ({ meta_ad_id: id, creative_id: creative, topic });
const r = (impressions: number, clicks: number, booked = 0) => ({ impressions, clicks, booked });
// a..e read in the same order as the old spend ranking, so the topic/creative cases below are unchanged
const results = new Map([["a", r(900, 30)], ["b", r(800, 24)], ["c", r(700, 14)], ["d", r(200, 9)], ["e", r(400, 4)], ["f", r(50, 0)]]);
const pool = [cand("a", "c1", "final_expense"), cand("b", "c2", "whole_life"), cand("c", "c3", "whole_life"), cand("d", "c4", "final_expense"), cand("e", "c5", "final_expense"), cand("f", "c3", "whole_life")];
assert.deepEqual(pickCarryOver(pool, { room: 4, topic: null, results, running: new Set() }).map((a) => a.meta_ad_id), ["a", "b", "c", "e"], "best click-through on a real read first, any topic, up to the room left");
assert.deepEqual(pickCarryOver(pool, { room: 4, topic: "final_expense", results, running: new Set() }).map((a) => a.meta_ad_id), ["a", "e", "d"], "a one-topic campaign only takes its topic");
assert.deepEqual(pickCarryOver(pool, { room: 4, topic: null, results, running: new Set(["c1", "c3"]) }).map((a) => a.meta_ad_id), ["b", "e", "d"], "one ad per creative, counting what's already running");
assert.equal(pickCarryOver(pool, { room: 0, topic: null, results, running: new Set() }).length, 0);
// Miguel's Oct 25-27: the ad Meta spent least on had the best read, and spend no longer decides
const miguelAds = [cand("memories", "m1", null), cand("lasts", "m2", null), cand("stays", "m3", null), cand("planning", "m4", null)];
const miguelResults = new Map([["memories", r(333, 9)], ["lasts", r(355, 7)], ["stays", r(309, 11)], ["planning", r(143, 4)]]);
assert.deepEqual(pickCarryOver(miguelAds, { room: 4, topic: null, results: miguelResults, running: new Set() }).map((a) => a.meta_ad_id), ["stays", "memories", "lasts", "planning"], "click-through on 300+ impressions, then the ads too new to judge");
assert.deepEqual(pickCarryOver(miguelAds, { room: 1, topic: null, results: new Map([...miguelResults, ["planning", r(143, 4, 1)]]), running: new Set() }).map((a) => a.meta_ad_id), ["planning"], "a booked call beats any click-through");
ok("one campaign per plan: on the only focus or across all of them; carried-over ads by results (not spend), on topic, one per creative; $350 deposit = $280 of ads = $20/day for 2 weeks");

// required questions
const { missingRequired, preBookingQuestions, DEFAULT_QUESTIONS } = await import("@/lib/booking/questions");
const qs = DEFAULT_QUESTIONS.map((q) => (q.key === "policy_description" ? { ...q, required: true } : q));
assert.deepEqual(preBookingQuestions(qs, []).map((q) => q.key), ["existing_coverage", "policy_description"], "a required question brings the question it depends on");
assert.equal(missingRequired(qs, [], { existing_coverage: "Yes" })?.key, "policy_description");
assert.equal(missingRequired(qs, [], { existing_coverage: "No" }), null, "hidden by another answer = not required");
assert.deepEqual(preBookingQuestions(DEFAULT_QUESTIONS, [1]).map((q) => q.key), ["date_of_birth", "gender", "marital_status", "nicotine"]);
assert.equal(missingRequired(DEFAULT_QUESTIONS, [1], { date_of_birth: "1980-01-01", gender: "Male", marital_status: "Single" })?.key, "nicotine");
assert.equal(missingRequired(DEFAULT_QUESTIONS.map((q) => ({ ...q, enabled: q.key !== "nicotine" })), [1], { date_of_birth: "1980-01-01", gender: "Male", marital_status: "Single" }), null, "turned-off questions are never required");
ok("required questions and required steps: asked before booking with what they depend on; hidden or turned-off ones aren't required");

// first week of a campaign collects results: no revisions
const { checkPauseAd: pauseCheck, checkPlacements: placementCheck } = await import("@/lib/migz/guardrails");
const early = { ...gctx, revisionsFrom: new Date("2026-10-22T05:00:00Z") };
assert.match(pauseCheck(early, "a") ?? "", /revisions .* start on 2026-10-22/);
assert.match(placementCheck(early, "A") ?? "", /collecting its first results/);
assert.equal(placementCheck({ ...gctx, revisionsFrom: new Date("2026-10-19T05:00:00Z") }, "A"), null);
ok("pauses, budget and placement edits wait for the campaign's first 7 days of results");

// campaign batches
const { batchOptions, recommendOption, outcomeEstimate, bestTopic, findOption, listCampaignTopics, MIN_BATCH_CENTS } = await import("@/lib/batch");
const noHistory = { spentCents: 0, bookedCalls: 0, batches: 0, byTopic: {} };
assert.equal(batchOptions(MIN_BATCH_CENTS - 100, ["final_expense"]).length, 0, "under the minimum there are no options");
const min2 = batchOptions(28_000, ["final_expense", "mortgage_protection"]);
assert.deepEqual(min2.map((o) => [o.key, o.campaigns, o.days, o.dailyCents]), [["focused", ["final_expense"], 14, 2000], ["balanced", [null], 14, 2000]], "$280: one campaign at $20/day for 2 weeks, on the main focus or on both");
assert.deepEqual(batchOptions(28_000, ["final_expense"]).map((o) => o.key), ["focused"], "one focus: one option");
const big = batchOptions(70_000, [...three]);
assert.deepEqual(big.map((o) => [o.key, o.campaigns, o.days, o.perCampaignCents, o.exploreCents]), [["focused", ["final_expense"], 35, 2000, 0], ["balanced", [null], 35, 2000, 0], ["explore", [null, "explore"], 14, 3000, 2000], ["sprint", [null], 7, 10_000, 0]], "single campaigns run longer, never wider; $700 also covers main + exploration, or a one-week sprint at $100/day");
for (const o of big) {
  assert.ok((o.key === "sprint" ? o.days === 7 && o.perCampaignCents >= 5000 : o.days >= 14) && o.perCampaignCents >= 2000 && (o.exploreCents === 0 || o.exploreCents >= 2000), `${o.key} keeps the limits`);
  assert.ok(o.dailyCents * o.days <= 70_000, `${o.key} stays within the batch`);
}
assert.match(big[1].blurb, /Final expense, Mortgage protection and Income protection side by side/);
assert.equal(listCampaignTopics([null]), "All your topics");
assert.equal(listCampaignTopics([null, "explore"]), "All your topics and Exploration");
assert.equal(recommendOption(big, [...three], noHistory).key, "explore", "when it fits, exploration keeps the main campaign learning");
assert.equal(recommendOption(min2, ["final_expense", "mortgage_protection"], noHistory).key, "balanced", "no data: ads on every topic in one campaign");
assert.equal(recommendOption(batchOptions(28_000, ["final_expense"]), ["final_expense"], noHistory).key, "focused");
const history = { spentCents: 60_000, bookedCalls: 20, batches: 1, byTopic: { final_expense: { spentCents: 20_000, bookedCalls: 12 }, mortgage_protection: { spentCents: 40_000, bookedCalls: 8 } } };
assert.equal(bestTopic(history), "final_expense", "$16.67 vs $50 per call is a clear winner");
assert.equal(recommendOption(batchOptions(42_000, ["mortgage_protection", "final_expense"], "final_expense"), ["mortgage_protection", "final_expense"], history).key, "focused", "a clear winner gets the batch");
const withRoom = recommendOption(batchOptions(56_000, ["mortgage_protection", "final_expense"], "final_expense"), ["mortgage_protection", "final_expense"], history);
assert.equal(withRoom.key, "explore", "with room to explore, the winner leads the main campaign instead");
assert.match(withRoom.reason, /Final expense books calls clearly cheaper/);
assert.equal(batchOptions(56_000, ["mortgage_protection", "final_expense"], "final_expense")[0].campaigns[0], "final_expense", "focused backs the winner, not just the first focus");
assert.deepEqual(outcomeEstimate(56_000, history), { costPerCallCents: 3000, low: 14, high: 22 });
assert.equal(outcomeEstimate(56_000, noHistory), null, "no estimate without the agent's own data");
assert.equal(findOption(28_000, ["final_expense"], "spread"), null, "the server re-derives options; a made-up one is refused");
ok("batches: one campaign at $20+/day for 14+ days, focused on one topic or on all of them; recommendation and estimate from the agent's own results");

// exploration campaigns: what money unlocks one, how the day splits, and Migz's advice
const { splitDaily, exploreAdvice, EXPLORE_MIN_BATCH_CENTS } = await import("@/lib/batch");
assert.equal(EXPLORE_MIN_BATCH_CENTS, 56_000, "$20/day main + $20/day exploring for 14 days");
assert.ok(!batchOptions(55_900, ["final_expense"]).some((o) => o.key === "explore"), "a cent short: no exploration");
assert.deepEqual(batchOptions(56_000, ["final_expense"]).map((o) => [o.key, o.campaigns, o.perCampaignCents, o.exploreCents]), [["focused", ["final_expense"], 2000, 0], ["explore", ["final_expense", "explore"], 2000, 2000], ["sprint", ["final_expense"], 8000, 0]]);
assert.equal(batchOptions(56_000, ["mortgage_protection", "final_expense"], "final_expense").at(-1)!.campaigns[0], "final_expense", "a clear winner leads the main campaign");
assert.deepEqual(splitDaily(5000, [null, "explore"]), [3000, 2000]);
assert.deepEqual(splitDaily(10_000, [null, "explore"]), [6000, 4000], "exploration gets 40%");
assert.deepEqual(splitDaily(4000, ["explore", null]), [2000, 2000], "in plan order; the main keeps its $20");
assert.deepEqual(splitDaily(2000, ["final_expense", "whole_life"]), [1000, 1000], "older plans split evenly");
assert.deepEqual(splitDaily(2000, [null]), [2000]);
const advice = exploreAdvice(28_000)!;
assert.deepEqual([advice.addCents, advice.totalCents, advice.depositCents], [28_000, 56_000, 35_000]);
assert.match(advice.message, /Add \$280 to this batch \(\$560 in total\).*\$20\/day exploration campaign for 14 days/);
assert.equal(exploreAdvice(56_000), null, "no advice once the option is on offer");
assert.deepEqual(campaignLabels(["final_expense", "explore"]), ["Final expense", "Exploration"]);

// new creative is tested in exploration; proven ads are promoted into the main ad set
const xad = (id: string, impressions: number, creative = id, status = "ACTIVE") => ({ meta_ad_id: id, status, impressions, spend_cents: impressions * 5, creative_id: creative });
const xctx = (mainAds: ReturnType<typeof xad>[], mainEdited = "2026-11-01T00:00:00Z", exploreAds = [xad("x1", 1400), xad("x2", 600)]) => ({
  ...gctx,
  now: new Date("2026-11-10T12:00:00Z"),
  adsets: [
    { meta_adset_id: "M", status: "ACTIVE", daily_budget_cents: 3000, learning_status: "LEARNING", last_edited_at: mainEdited, role: "main" as const, ads: mainAds },
    { meta_adset_id: "X", status: "ACTIVE", daily_budget_cents: 2000, learning_status: "LEARNING", last_edited_at: "2026-11-01T00:00:00Z", role: "explore" as const, ads: exploreAds },
  ],
});
const { checkLaunchTarget: launchCheck, checkPromoteAd, variantTarget } = await import("@/lib/migz/guardrails");
const two = xctx([xad("m1", 3000), xad("m2", 2000)]);
assert.match(launchCheck(two, "M") ?? "", /exploration ad set \(X\) first/, "new creative can't go straight into the main ad set");
assert.equal(launchCheck(two, "X"), null);
assert.equal(launchCheck(xctx([]), "M"), null, "an empty main ad set can take its first ads");
assert.equal(launchCheck(gctx, "A"), null, "no exploration campaign: launch anywhere as before");
assert.equal(variantTarget(two, "M"), "X", "variants of a main ad are tested in exploration");
assert.equal(variantTarget(two, "X"), "X");
assert.equal(variantTarget(gctx, "A"), "A");
assert.equal(checkPromoteAd(two, "x1"), null, "1,400 impressions, room, main untouched for 9 days: promote (Meta's LEARNING status doesn't block it)");
assert.match(checkPromoteAd(two, "x2") ?? "", /600 impressions/);
assert.match(checkPromoteAd(two, "m1") ?? "", /isn't in the exploration campaign/);
assert.match(checkPromoteAd(xctx([1, 2, 3, 4, 5].map((i) => xad(`m${i}`, 2000))), "x1") ?? "", /already has 5 live ads/);
assert.match(checkPromoteAd(xctx([xad("m1", 3000)], "2026-11-09T00:00:00Z"), "x1") ?? "", /changed 1 day\(s\) ago/, "one restart every 3 days");
assert.equal(checkPromoteAd(xctx([xad("m1", 3000)], "2026-11-10T11:00:00Z"), "x1"), null, "promotions made together count as one restart");
assert.match(checkPromoteAd(xctx([xad("m1", 3000, "x1")]), "x1") ?? "", /already runs in the main ad set/);
assert.match(checkPromoteAd({ ...two, revisionsFrom: new Date("2026-11-12T00:00:00Z") }, "x1") ?? "", /revisions/);
const promoted = evalTool("promote_ad", { ad_id: "x1", title: "Promoted the porch video", reason: "1.9% click-through vs 1.1% in main" }, two);
assert.deepEqual(promoted.ok && promoted.payload, { tool: "promote_ad", ad_id: "x1", adset_id: "M" });
ok("exploration: $560 unlocks it, 40% of the day (at least $20), advice to add the rest; tests launch in exploration, winners are promoted with enough data, room and 3 days between restarts");

// carousels
const carouselInput = { concept: "Mortgage then coverage", topic: "mortgage_protection", style: "warm natural light", primary_text: "Who keeps paying the mortgage if you can't? A free call walks you through it.", launch_adset_id: "A", title: "t", reason: "r",
  cards: [{ scene: "A couple on the porch of their new house", overlay_lines: ["The house is yours."], headline: "Your home" }, { scene: "The same couple at the kitchen table, relaxed", overlay_lines: ["Keep it that way."], headline: "Protect it" }] };
const car = evalTool("generate_carousel", carouselInput, gctx);
assert.ok(car.ok, JSON.stringify(car));
assert.equal((car as { payload: { brief: { cards: unknown[] } } }).payload.brief.cards.length, 2);
assert.match((evalTool("generate_carousel", { ...carouselInput, cards: [...carouselInput.cards, carouselInput.cards[0]] }, gctx) as { error: string }).error, /exactly 2 cards/);
assert.match((evalTool("generate_carousel", { ...carouselInput, launch_adset_id: "" }, gctx) as { error: string }).error, /launch_adset_id/);
const { cardBrief, briefLabel } = await import("@/lib/migz/brief");
const card = imageRequest(cardBrief((car as { payload: { brief: never } }).payload.brief, 1));
assert.equal(card.model, "ideogram"); assert.equal(card.body.aspect_ratio, "1:1"); assert.match(String(card.body.prompt), /1:1 square/); assert.match(String(card.body.prompt), /Keep it that way\./);
assert.equal(briefLabel((car as { payload: { brief: never } }).payload.brief), "The house is yours.");
ok("2-card carousels: exactly 2 cards, launched into an ad set, each card a square feed-model still with its own text");

// the Brain lights whatever is actually working, in a review or not
const { deriveGraph } = await import("@/components/dashboard/brain/state");
const at = (s: number) => new Date(Date.UTC(2026, 9, 21, 12, 0, s)).toISOString();
const ev = (id: number, o: object) => ({ id, run_id: null, model: null, evidence: {}, input_tokens: 0, output_tokens: 0, started_at: at(0), finished_at: null, summary: "x", ...o });
const idleLive = { now: at(30), running: false, runId: "r1", lastRun: { status: "succeeded", started_at: at(-600), finished_at: at(-500), summary: null, skipped_reason: null }, nextRunAt: null, mode: "auto",
  events: [ev(1, { run_id: "r1", step: "finished", tier: "code", started_at: at(-500), finished_at: at(-500) }), ev(2, { step: "drafting", tier: "higgsfield", summary: "Making an image" }), ev(3, { step: "acting", tier: "code", summary: "Building the ad in Meta" })] };
const g = deriveGraph(idleLive as never, Date.parse(at(30)));
assert.deepEqual([...g.active].sort(), ["higgsfield", "meta"], "no review running, but Higgsfield and Meta are working");
assert.equal(deriveGraph({ ...idleLive, events: [ev(9, { step: "acting", tier: "code", started_at: at(-3600) })] } as never, Date.parse(at(30))).active.size, 0, "a step left open for an hour crashed: not lit");
const syncing = deriveGraph({ ...idleLive, running: true, events: [ev(4, { run_id: "r1", step: "syncing", tier: "code", started_at: at(0) })] } as never, Date.parse(at(5)));
assert.ok(syncing.active.has("meta"), "pulling results from Meta lights the Meta node");
ok("Brain: background work (a generation, a Meta upload) lights its node outside a review; syncing lights Meta; stale steps don't");

// batch pacing: Meta's up-to-25% daily overspend can't take a batch over its budget
const { pacedDailyCents, batchEndTime } = await import("@/lib/batch");
assert.equal(pacedDailyCents({ budgetCents: 28_000, spentCents: 0, daysLeft: 14, plannedDailyCents: 2000 }), 2000, "on plan: the planned $20/day");
assert.equal(pacedDailyCents({ budgetCents: 28_000, spentCents: 14_000, daysLeft: 7, plannedDailyCents: 2000 }), 1600, "last week: $140 left over 7 days at 25% hot = $16/day");
assert.equal(pacedDailyCents({ budgetCents: 28_000, spentCents: 28_100, daysLeft: 3, plannedDailyCents: 2000 }), 0, "over: stop");
assert.equal(pacedDailyCents({ budgetCents: 28_000, spentCents: 5000, daysLeft: 7, plannedDailyCents: 2000 }), 2000, "underspent ($50 by day 8): never above the plan");
for (const [budget, days, planned] of [[28_000, 14, 2000], [56_000, 14, 4000], [70_000, 35, 2000], [42_000, 15, 2800]]) {
  // Worst case, stricter than Meta's rule: every single day runs 25% over whatever the budget is set to,
  // and budgets are only ever lowered (as paceBudgets does)
  let spent = 0;
  let setTo = planned;
  for (let day = 0; day < days; day++) {
    setTo = Math.min(setTo, pacedDailyCents({ budgetCents: budget, spentCents: spent, daysLeft: days - day, plannedDailyCents: planned }));
    if (setTo < 500) break; // under one ad set's minimum: paused as "budget used up"
    spent += Math.floor(setTo * 1.25);
  }
  assert.ok(spent <= budget, `$${budget / 100} over ${days} days, 25% hot every day: spent $${spent / 100}`);
  assert.ok(spent >= budget * 0.8, `still spends most of it ($${spent / 100} of $${budget / 100})`);
}
assert.equal(batchEndTime("2026-11-03", "America/Chicago"), "2026-11-03T23:59:59.000-06:00".replace(".000", ""));
ok("pacing: even 25% over every day, a batch never finishes over budget (and still spends most of it); Meta stops at 23:59 on the last day");

// Slack: rich updates with an ad preview
const sb = await import("@/lib/migz/slack-blocks");
const preview = { pageName: "Miguel Cruz", primaryText: "Who pays the mortgage if you can't? <script> & *bold*", headline: "Protect your home", images: [{ url: "https://img.test/a.png", alt: "a" }, { url: "https://img.test/b.png", alt: "b" }], bookingUrl: "https://anryhlabs.com/miguel-cruz", format: "carousel" as const };
const live = sb.adLiveMessage({ ad: preview, campaign: "Mortgage protection", states: ["IL", "TX"], held: false, dashboardUrl: "https://anryhlabs.com" });
const liveJson = JSON.stringify(live.blocks);
assert.match(live.text, /Your new ad is with Meta for review: Protect your home/);
assert.match(liveJson, /as soon as it's approved/);
assert.equal((live.blocks as { type: string }[]).filter((b) => b.type === "image").length, 2, "both carousel cards shown");
assert.match(liveJson, /Book now/); assert.match(liveJson, /anryhlabs\.com\/miguel-cruz/); assert.match(liveJson, /Sponsored/);
assert.ok(!liveJson.includes("<script>") && liveJson.includes("&lt;script&gt;"), "ad copy is escaped");
assert.match(JSON.stringify(sb.adLiveMessage({ ad: { ...preview, format: "image", images: [preview.images[0]] }, campaign: "x", states: ["IL"], held: true, dashboardUrl: "u" }).blocks), /paused for testing|Test mode keeps it paused/);
assert.equal(sb.reviewSummaryMessage({ summary: "Quiet.", applied: [], proposed: [], dashboardUrl: "u" }), null, "a review that did nothing sends nothing");
const waiting = sb.reviewSummaryMessage({ summary: "Two ideas.", applied: ["Held budget steady"], proposed: [{ title: "Made a feed image", detail: "Main focus has no image." }], dashboardUrl: "https://a.b" })!;
assert.match(waiting.text, /waiting for your OK/); assert.match(JSON.stringify(waiting.blocks), /#approvals/); assert.match(JSON.stringify(waiting.blocks), /Held budget steady/);
// Then Meta's verdict, in one message per check
const pv = (headline: string, format: "image" | "video" = "image") => ({ ...preview, headline, format, images: [preview.images[0]] });
const one = sb.adsReviewedMessage({ approved: [{ ad: pv("Plan ahead", "video"), campaign: "Final expense" }], rejected: [], states: ["TX", "OH"], dashboardUrl: "https://app" });
assert.equal(one.text, "Meta approved your new ad");
assert.match(JSON.stringify(one.blocks), /now showing to adults in TX, OH/);
assert.equal((one.blocks as { type: string }[]).filter((b) => b.type === "image").length, 1, "a single approval shows the ad");
const mixed = sb.adsReviewedMessage({ approved: [{ ad: pv("A"), campaign: "Whole life" }, { ad: pv("B"), campaign: "Whole life" }], rejected: [{ ad: pv("C"), campaign: "Final expense", reason: "Financial claims" }], states: ["TX"], dashboardUrl: "https://app" });
assert.equal(mixed.text, "Meta approved 2 ads, and didn't approve 1 ad");
assert.match(JSON.stringify(mixed.blocks), /Meta said: _Financial claims_/);
assert.equal(sb.adsReviewedMessage({ approved: [], rejected: [{ ad: pv("C"), campaign: "x", reason: null }], states: ["TX"], dashboardUrl: "u" }).text, "Meta didn't approve your new ad");
const exploreMsg = sb.batchSetupMessage({ budgetCents: 70_000, days: 14, campaigns: ["Final expense + Whole life", "Exploration"], perCampaignCents: 3000, campaignCents: [3000, 2000], states: ["IL"], endsOn: "2026-11-20", auto: true, dashboardUrl: "u" });
assert.match(JSON.stringify(exploreMsg.blocks), /Exploration \(\$20\/day\).*\$50\/day in total/);
const setupMsg = sb.batchSetupMessage({ budgetCents: 28_000, days: 14, campaigns: ["Final expense", "Policy review"], perCampaignCents: 1000, states: ["IL", "OH"], endsOn: "2026-11-04", auto: false, dashboardUrl: "u" });
assert.match(setupMsg.text, /Your \$280 campaign batch is set up/); assert.match(JSON.stringify(setupMsg.blocks), /Ask me first is on/);
assert.match(sb.batchEndedMessage({ budgetCents: 28_000, spentCents: 25_000, bookedCalls: 10, dashboardUrl: "u" }).text, /10 booked calls from \$250/);
ok("Slack: sent-to-Meta preview (page, copy, both carousel cards, Book now), then Meta approved / not approved with the reason, escaped copy, review summary with approvals link, batch set up / ended; silent when nothing happened");

// Facebook vs Instagram: focus only on clear booked-call evidence
const { platformOf, checkPlatformFocus, strongerPlatform } = await import("@/lib/migz/platforms");
assert.deepEqual(["Instagram_Reels", "Facebook_Mobile_Feed", "instagram", "facebook", "Messenger_Inbox", undefined].map(platformOf), ["instagram", "facebook", "instagram", "facebook", null, null]);
const st = (fbSpend: number, fbCalls: number, igSpend: number, igCalls: number) => ({ facebook: { spendCents: fbSpend, impressions: 0, linkClicks: 0, bookedCalls: fbCalls }, instagram: { spendCents: igSpend, impressions: 0, linkClicks: 0, bookedCalls: igCalls } });
const igOnly = ["instagram_feed", "instagram_reels", "instagram_stories"];
assert.equal(checkPlatformFocus(st(10_000, 2, 10_000, 8), igOnly), null, "IG: 8 calls at $12.50 vs FB $50: focus allowed");
assert.equal(strongerPlatform(st(10_000, 2, 10_000, 8)), "instagram");
assert.match(checkPlatformFocus(st(10_000, 2, 6_000, 4), igOnly) ?? "", /needs at least 5/, "too few calls on the kept side");
assert.match(checkPlatformFocus(st(3_000, 0, 10_000, 8), igOnly) ?? "", /at least \$40\.00 of spend/, "the other side barely ran");
assert.match(checkPlatformFocus(st(10_000, 7, 9_000, 8), igOnly) ?? "", /25% cheaper/, "$11.25 vs $14.29 isn't a clear win");
assert.equal(checkPlatformFocus(st(10_000, 0, 10_000, 8), igOnly), null, "FB $100 with no bookings vs IG $12.50 each: allowed");
assert.equal(checkPlatformFocus(st(0, 0, 0, 0), []), null, "back to automatic is always allowed");
assert.equal(checkPlatformFocus(st(0, 0, 0, 0), ["facebook_reels", "instagram_reels"]), null, "narrowing positions on both platforms isn't a platform focus");
const { checkPlacements: placementGuard } = await import("@/lib/migz/guardrails");
const focusCtx = { ...gctx, adsets: [{ ...gctx.adsets[0], platforms: st(10_000, 7, 9_000, 8) }] };
assert.match(placementGuard(focusCtx, "A", igOnly) ?? "", /Not enough evidence to drop facebook/);
assert.equal(placementGuard({ ...gctx, adsets: [{ ...gctx.adsets[0], platforms: st(10_000, 1, 10_000, 9) }] }, "A", igOnly), null);
ok("platforms: Instagram/Facebook from Meta's placement tags; dropping one needs 5+ calls, $40 each side and 25% cheaper calls; automatic and both-platform narrowing stay allowed");

// Videos follow the short-film standard
const { videoPrompt, shotPrompts, VIDEO_REALISM } = await import("@/lib/migz/brief");
const film = {
  concept: "a family protected by a 30-year term life insurance policy",
  style: "Warm natural light, soft film grain, handheld documentary style, muted earthy colors",
  setting: "a real suburban home",
  cast: "a woman in her late 30s; her son about 6 and daughter about 9",
  mood: "grief turning into gratitude and relief. Hopeful, never dark. No funerals, hospitals, or caskets.",
  hook_line: "He planned ahead.",
  hook_shot: "Close-up at dawn. The woman sits alone at a kitchen table, holding a man's wristwatch, eyes wet. She hears small footsteps and looks up toward the hallway.",
  body_shots: [
    { prompt: "Her two young kids run into the same sunlit kitchen in pajamas. She wipes her eyes, smiles, and pulls them into a tight hug while breakfast cooks.", duration: 4 },
    { prompt: "Years later, the same house. The daughter in a graduation gown laughs and hugs her mother on the front porch.", duration: 4 },
    { prompt: "The mother straightens a framed family photo on the mantel, touches it gently, and smiles in golden evening light.", duration: 4 },
  ],
  primary_text: "He planned ahead, so they kept their home.", headline: "Plan ahead for them",
};
const whole = videoPrompt(film);
assert.match(whole, /^A 15-second vertical short film about a family protected by a 30-year term life insurance policy\. Warm natural light.*, a real suburban home\. No text, no logos, no captions\./);
assert.match(whole, /The same people appear throughout: a woman in her late 30s/);
assert.match(whole, /Shot 1 \(0–3s\): Close-up at dawn/); assert.match(whole, /Shot 2 \(3–7s\)/); assert.match(whole, /Shot 4 \(11–15s\): The mother straightens/);
assert.match(whole, /Mood: grief turning into gratitude/); assert.ok(whole.endsWith(VIDEO_REALISM));
assert.match(VIDEO_REALISM, /no one looks into the camera/); assert.match(VIDEO_REALISM, /No exaggerated or forced laughing/);
const perShot = shotPrompts(film);
assert.deepEqual(perShot.map((x) => x.duration), [3, 4, 4, 4]);
assert.ok(perShot.every((x) => x.prompt.length <= 512 && /Same people: a woman in her late 30s/.test(x.prompt) && /nobody looks at the camera/.test(x.prompt)), "each shot keeps the cast and the realism rule");
const vidBase = { concept: "c", topic: "term_life", style: "warm", hook_line: "Is your family covered?", hook_shot: "A mother at the table", body_shots: [{ prompt: "She hugs her kids", duration: 4 }], primary_text: "Is your family covered? A free call walks you through it.", headline: "Plan ahead", launch_adset_id: null, title: "t", reason: "r" };
assert.match((evalTool("generate_video", vidBase, gctx) as { error: string }).error, /needs a cast/, "a video without cast, setting and mood is refused");
assert.equal(evalTool("generate_video", { ...vidBase, cast: "a mother in her 30s and two kids", setting: "a family kitchen", mood: "worry turning into relief", voiceover: "She planned ahead. A free call can help you do the same." }, gctx).ok, true);
ok("videos: written as a short film (topic, look, place, same cast, timed shots, mood) with realism rules on the whole and every shot; cast/setting/mood required");

// Video continuity and voiceover
const { timeJumpWithoutAging, VIDEO_CONTINUITY } = await import("@/lib/migz/brief");
assert.equal(timeJumpWithoutAging("Years later, the tree they planted is fully grown and the family stands under it."), true, "the planted-tree problem is caught");
assert.equal(timeJumpWithoutAging("Now grown, the oak shades the yard as the kids play."), true);
assert.equal(timeJumpWithoutAging("Years later, the daughter is a teenager in a graduation gown and hugs her mother on the porch."), false, "a time jump that says how they aged is fine");
assert.equal(timeJumpWithoutAging("Her two kids run into the same sunlit kitchen in pajamas."), false, "no time jump, nothing to check");
const narrated = videoPrompt({ ...film, voiceover: "She never had to choose between the house and their future. He made sure of that." });
assert.ok(narrated.includes(VIDEO_CONTINUITY));
assert.match(narrated, /Voiceover: an off-screen narrator .* says: "She never had to choose/); assert.match(narrated, /no one on screen speaks or moves their lips/);
assert.match(videoPrompt(film), /No narration and no dialogue/);
assert.ok(shotPrompts(film).every((x) => /unless this shot says time has passed/.test(x.prompt) && x.prompt.length <= 512));
const goodVideo = { ...vidBase, cast: "a mother in her 30s and two kids", setting: "a family home and backyard", mood: "worry turning into relief", voiceover: "She planned ahead, so they stayed home. A free call can help you plan too." };
assert.equal((evalTool("generate_video", { ...goodVideo, narrator: "male" }, gctx) as { payload: { brief: { narrator: string } } }).payload.brief.narrator, "male");
assert.equal((evalTool("generate_video", goodVideo, gctx) as { payload: { brief: { narrator: string } } }).payload.brief.narrator, "female", "no narrator given: Victoria");
const tree = evalTool("generate_video", { ...goodVideo, body_shots: [{ prompt: "The family plants a small tree in the backyard", duration: 4 }, { prompt: "Years later, the tree is fully grown and the family picnics under it", duration: 4 }] }, gctx);
assert.ok(!tree.ok && /Shot 3 jumps forward in time but doesn't say how the people have aged/.test((tree as { error: string }).error), JSON.stringify(tree));
assert.equal(evalTool("generate_video", { ...goodVideo, body_shots: [{ prompt: "The family plants a small tree in the backyard", duration: 4 }, { prompt: "Years later, the kids are teenagers and the mother has grey in her hair, sitting under the now tall tree", duration: 4 }] }, gctx).ok, true);
const voiced = evalTool("generate_video", { ...goodVideo, voiceover: "He planned ahead, so they kept their home." }, gctx);
assert.ok(voiced.ok && (voiced as { payload: { brief: { voiceover: string } } }).payload.brief.voiceover === "He planned ahead, so they kept their home.");
assert.match((evalTool("generate_video", { ...goodVideo, voiceover: Array(45).fill("word").join(" ") }, gctx) as { error: string }).error, /45 words; keep it to 40/);
assert.equal(evalTool("generate_video", { ...goodVideo, voiceover: "Guaranteed approval, no matter what." }, gctx).ok, false, "narration follows the insurance copy rules");
assert.match((evalTool("generate_video", { ...goodVideo, voiceover: null }, gctx) as { error: string }).error, /Every video needs a voiceover/, "narration is required");
assert.match((evalTool("generate_video", { ...goodVideo, voiceover: "   " }, gctx) as { error: string }).error, /Every video needs a voiceover/, "blank narration doesn't count");
ok("videos: continuity rules on every video and shot, time jumps must say how people aged (planted tree refused); a required off-screen voiceover, 40 words max, same copy rules");

// Narration: the voice is laid over the video with the bundled ffmpeg
const { mixNarration } = await import("@/lib/migz/narration");
const fsx = await import("node:fs");
const mixDir = fsx.mkdtempSync(`${process.env.TMPDIR ?? "/tmp/"}migz-mix-`);
execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x568:rate=24", "-f", "lavfi", "-i", "anoisesrc=d=4:a=0.002", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", `${mixDir}/v.mp4`]);
execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=2", "-y", `${mixDir}/short.mp3`]);
execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=700:duration=10", "-y", `${mixDir}/long.mp3`]);
const { spawnSync } = await import("node:child_process");
const report = (file: string) => spawnSync(ff, ["-hide_banner", "-i", file, "-af", "highpass=f=300,lowpass=f=3400,volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
for (const voice of ["short", "long"]) {
  const out = await mixNarration(fsx.readFileSync(`${mixDir}/v.mp4`), fsx.readFileSync(`${mixDir}/${voice}.mp3`));
  fsx.writeFileSync(`${mixDir}/${voice}-out.mp4`, out!);
  const r = report(`${mixDir}/${voice}-out.mp4`);
  const secs = Number((r.match(/Duration: 00:00:([\d.]+)/) ?? [])[1]);
  assert.ok(Math.abs(secs - 4) < 0.15, `${voice} voice: output keeps the video's length (${secs}s)`);
  assert.match(r, /Video: h264/); assert.match(r, /Audio: aac/);
  assert.ok(Number((r.match(/max_volume: (-?[\d.]+) dB/) ?? [])[1]) > -20, `${voice} voice is audible over the scene`);
}
// The scene's sound carries on after the narrator stops (it used to be cut at the last word)
const tailLevel = (file: string) => Number((spawnSync(ff, ["-hide_banner", "-ss", "3", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/mean_volume: (-?[\d.]+) dB/) ?? [])[1]);
assert.ok(tailLevel(`${mixDir}/short-out.mp4`) > -60, `scene sound still audible after a 2s voice ends (${tailLevel(`${mixDir}/short-out.mp4`)} dB in the last second)`);
// A music bed fills the end once the narrator stops, well above the scene's own sound
execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=22", "-y", `${mixDir}/music.mp3`]);
const scored = await mixNarration(fsx.readFileSync(`${mixDir}/v.mp4`), fsx.readFileSync(`${mixDir}/short.mp3`), fsx.readFileSync(`${mixDir}/music.mp3`));
fsx.writeFileSync(`${mixDir}/music-out.mp4`, scored!);
const scoredSecs = Number((report(`${mixDir}/music-out.mp4`).match(/Duration: 00:00:([\d.]+)/) ?? [])[1]);
assert.ok(Math.abs(scoredSecs - 4) < 0.15, `music doesn't make the video longer (${scoredSecs}s)`);
assert.ok(tailLevel(`${mixDir}/music-out.mp4`) > tailLevel(`${mixDir}/short-out.mp4`) + 3, `music fills the end (${tailLevel(`${mixDir}/music-out.mp4`)} dB vs ${tailLevel(`${mixDir}/short-out.mp4`)} dB without it)`);
const { narratorVoices } = await import("@/lib/migz/narration");
assert.deepEqual(narratorVoices("female"), ["z7U1SjrEq4fDDDriOQEN", "GU8Qu28KNb4JbhQV7DX7", "nPczCjzI2devNBz1zQrb"], "Vivie, then Mark, then ElevenLabs' own narrator");
assert.deepEqual(narratorVoices("male")[0], "GU8Qu28KNb4JbhQV7DX7");
ok("narration: the voice is mixed over the video with the picture untouched; a voice longer than the video is sped up and cut to fit; the scene sound carries on after the voice; a music bed fills the end; Vivie / Mark with fallbacks");

// Stripe keys: live keys only ever on Vercel Production
const { stripeKey } = await import("@/lib/stripe");
const keyEnv = { main: process.env.STRIPE_SECRET_KEY, test: process.env.STRIPE_TEST_SECRET_KEY, vercel: process.env.VERCEL_ENV };
const setKeys = (main?: string, test?: string, vercel?: string) => {
  for (const [k, v] of [["STRIPE_SECRET_KEY", main], ["STRIPE_TEST_SECRET_KEY", test], ["VERCEL_ENV", vercel]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
setKeys("rk_live_x", "sk_test_y", undefined);
assert.equal(stripeKey(), "sk_test_y", "locally the test key wins");
setKeys("rk_live_x", undefined, "preview");
assert.equal(stripeKey(), null, "a live key on a preview is refused");
setKeys("rk_live_x", "sk_test_y", "production");
assert.equal(stripeKey(), "rk_live_x", "Production uses the live key");
setKeys("sk_test_z", undefined, undefined);
assert.equal(stripeKey(), "sk_test_z", "a test key under the main name works anywhere");
setKeys(keyEnv.main, keyEnv.test, keyEnv.vercel);
ok("Stripe: live keys only run on Vercel Production; local and preview use the test key");

// Ghost bookings: some open times held back, stable, at least 2 a day, only the next 2 weeks
const { generateSlots, withGhostHolds } = await import("@/lib/booking/slots");
const gNow = new Date("2026-10-23T12:00:00Z");
const weekdays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_time: "09:00", end_time: "17:00" }));
const allSlots = generateSlots(weekdays, [], { timezone: "America/Chicago", slotMinutes: 30, bufferMinutes: 0, minNoticeHours: 0, maxDaysAhead: 21 }, gNow);
const shown = withGhostHolds(allSlots, "agent-1", "America/Chicago", gNow);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const count = (xs: string[]) => xs.reduce((m, x) => m.set(dayOf(x), (m.get(dayOf(x)) ?? 0) + 1), new Map<string, number>());
const before = count(allSlots), after = count(shown);
assert.ok(shown.length < allSlots.length, "some times are held");
assert.deepEqual(withGhostHolds(allSlots, "agent-1", "America/Chicago", gNow), shown, "the same times stay held across page loads");
assert.notDeepEqual(withGhostHolds(allSlots, "agent-2", "America/Chicago", gNow), shown, "each agent's pattern is its own");
for (const [day, n] of before) {
  const left = after.get(day) ?? 0;
  assert.ok(left >= Math.min(2, n), `${day} keeps at least 2 times (${left} of ${n})`);
}
const lastDays = [...before.keys()].sort().slice(-5);
for (const d of lastDays) assert.equal(after.get(d), before.get(d), `${d} is beyond two weeks: untouched`);
const firstDay = [...before.keys()].sort()[0];
assert.ok(after.get(firstDay)! < before.get(firstDay)!, "the next few days look busy");
assert.ok(shown.every((s) => allSlots.includes(s)), "never invents a time");
assert.deepEqual(withGhostHolds(allSlots.slice(0, 2), "agent-1", "America/Chicago", gNow), allSlots.slice(0, 2), "a day with only 2 times keeps both");
// The page shows held and booked times greyed out: taken = every time in the agent's hours minus the open ones
const booked = [{ start: new Date(allSlots[3]), end: new Date(Date.parse(allSlots[3]) + 30 * 60_000) }];
const free = generateSlots(weekdays, booked, { timezone: "America/Chicago", slotMinutes: 30, bufferMinutes: 0, minNoticeHours: 0, maxDaysAhead: 21 }, gNow);
const openNow = withGhostHolds(free, "agent-1", "America/Chicago", gNow);
const takenNow = allSlots.filter((x) => !openNow.includes(x));
assert.ok(takenNow.includes(allSlots[3]), "a real booking shows as taken");
assert.ok(takenNow.length > 1, "ghost holds show as taken too");
assert.equal(takenNow.length + openNow.length, allSlots.length, "every time is either open or taken, none lost");

// Start-time spacing: 15-minute calls offered on the hour (9:00, 10:00, 11:00)
const oneDay = [{ weekday: 1, start_time: "09:00", end_time: "12:00" }];
const mon = new Date("2026-10-25T12:00:00Z"); // a Sunday, so Monday Oct 26 is tomorrow
const cfg = (slotMinutes: number, intervalMinutes: number | null) => ({ timezone: "America/Chicago", slotMinutes, intervalMinutes, bufferMinutes: 0, minNoticeHours: 0, maxDaysAhead: 2 });
const local = (xs: string[]) => xs.map((x) => new Date(x).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }));
assert.deepEqual(local(generateSlots(oneDay, [], cfg(15, 60), mon)), ["9:00 AM", "10:00 AM", "11:00 AM"], "15-min calls, hourly start times");
assert.equal(generateSlots(oneDay, [], cfg(15, null), mon).length, 12, "no spacing set: every 15 minutes, as before");
assert.deepEqual(local(generateSlots(oneDay, [], cfg(60, 30), mon)), ["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"], "an hour-long call still has to fit before closing");
const busy10 = [{ start: new Date(generateSlots(oneDay, [], cfg(15, 60), mon)[1]), end: new Date(Date.parse(generateSlots(oneDay, [], cfg(15, 60), mon)[1]) + 15 * 60_000) }];
assert.deepEqual(local(generateSlots(oneDay, busy10, cfg(15, 60), mon)), ["9:00 AM", "11:00 AM"], "a booked 15-min call takes only its own hour slot");

// Research shift: rotates the agent's topics and the angles; web search every other cycle
const { nextAssignment, ANGLES } = await import("@/lib/migz/research");
const r0 = nextAssignment(["final_expense", "whole_life"], 0), r1 = nextAssignment(["final_expense", "whole_life"], 1), r2 = nextAssignment(["final_expense", "whole_life"], 2);
assert.deepEqual([r0.topic, r1.topic, r2.topic], ["final_expense", "whole_life", "final_expense"]);
assert.equal(r0.angle.key, ANGLES[0].key); assert.equal(r2.angle.key, ANGLES[1].key, "each topic walks the angles");
assert.deepEqual([r0.web, r1.web, r2.web], [true, false, true]);
assert.equal(nextAssignment([], 0).topic, "mortgage_protection", "no focus: sensible defaults");
const { parseTagged } = await import("@/lib/migz/research");
assert.deepEqual(parseTagged('I searched.\n<note>{"finding":"A","sources":[]}</note>', "note"), { finding: "A", sources: [] });
assert.deepEqual(parseTagged('Here it is: {"finding":"B","sources":[{"title":"t","url":"https://x"}]}', "note"), { finding: "B", sources: [{ title: "t", url: "https://x" }] }, "untagged JSON still reads");
assert.equal(parseTagged('<note>{"finding":"C","sources":[{"title":"t","url":"https://x"},', "note"), null, "a cut-off answer is a miss, not a crash");
const rsb = await import("@/lib/migz/slack-blocks");
const idea = rsb.researchIdeaMessage({ topic: "Final expense", angle: "winning hooks", finding: "Questions about family memories outperform cost framing.", history: "Fits: the family video is our best hook.", idea: { format: "video", hook_line: "What will they remember?", concept: "Grandmother and grandkids baking.", why: "Warmth over fear." }, sources: [{ title: "Ad roundup", url: "https://example.com/a" }], dashboardUrl: "https://app" });
assert.match(idea.text, /idea for your next final expense ad: "What will they remember\?"/);
assert.match(JSON.stringify(idea.blocks), /example\.com\/a\|Ad roundup/);
ok("ghost bookings (stable holds, 2+ times a day, only 2 weeks out, never invented) and the research shift's rotation and Slack idea");

// Staff "view as" must survive Next.js link prefetching (a prefetched exit link used to end the view)
const { isPrefetch } = await import("@/lib/prefetch");
const reqWith = (h: Record<string, string>) => new Request("https://app/admin/view/exit", { headers: h });
assert.equal(isPrefetch(reqWith({ "next-router-prefetch": "1" })), true);
assert.equal(isPrefetch(reqWith({ purpose: "prefetch" })), true);
assert.equal(isPrefetch(reqWith({ "sec-purpose": "prefetch;anonymous-client-ip" })), true);
assert.equal(isPrefetch(reqWith({ accept: "text/html" })), false, "a real click is not a prefetch");
ok("view-as: prefetch requests (Next.js and browser) are recognised, real clicks are not");

// Page analytics: funnel, drop-off, scroll, sources and days from raw page events
const { pageAnalytics } = await import("@/lib/admin/page-analytics");
const paAt = (min: number) => new Date(Date.parse("2026-10-23T15:00:00Z") + min * 60_000).toISOString();
const pev = (session: string, name: string, min: number, meta: Record<string, unknown> = {}) => ({ session_id: session, name, meta, created_at: paAt(min) });
const rows = [
  // a: phone, from a Meta ad, used Soonest, booked
  pev("a", "view", 0, { source: "meta", device: "mobile" }), pev("a", "see_calendar", 0.1), pev("a", "scroll", 0.2, { depth: 50 }), pev("a", "pick_soonest", 0.5), pev("a", "form_start", 0.6), pev("a", "submit", 1), pev("a", "booked", 1.1), pev("a", "leave", 1.2, { ms: 72000 }),
  // b: phone, saw the times, left
  pev("b", "view", 5, { source: "facebook", device: "mobile" }), pev("b", "see_calendar", 5.1), pev("b", "leave", 5.3, { ms: 18000 }),
  // c: desktop, picked a time, started details, gave up
  pev("c", "view", 9, { source: "direct", device: "desktop" }), pev("c", "see_calendar", 9.1), pev("c", "pick_day", 9.2), pev("c", "pick_time", 9.3), pev("c", "form_start", 9.4), pev("c", "scroll", 9.5, { depth: 100 }), pev("c", "leave", 10, { ms: 60000 }),
  // d: phone, never saw the times
  pev("d", "view", 12, { source: "meta", device: "mobile" }), pev("d", "leave", 12.1, { ms: 4000 }),
  // stray events from a visit that started before the window: ignored
  pev("old", "pick_time", 1),
];
const pa = pageAnalytics(rows, 7, "America/Chicago", new Date("2026-10-23T20:00:00Z"));
assert.equal(pa.sessions, 4, "a visit counts once it opened the page");
assert.deepEqual(pa.funnel.map((f) => f.sessions), [4, 3, 2, 2, 1, 1]);
assert.equal(pa.booked, 1); assert.equal(pa.conversion, 0.25);
assert.deepEqual(pa.biggestDrop, { from: "Opened the page", to: "Saw the times", lost: 1 }, "ties keep the earliest step");
assert.equal(pa.medianSeconds, 39, "median of 72, 18, 60 and 4 seconds");
assert.equal(pa.mobileShare, 0.75);
assert.equal(pa.soonestShare, 0.5, "1 of the 2 who picked a time used Soonest");
assert.deepEqual(pa.scroll.map((x) => x.pct), [0.5, 0.5, 0.25, 0.25]);
assert.deepEqual(pa.sources, [{ source: "meta ads", sessions: 3, booked: 1 }, { source: "direct", sessions: 1, booked: 0 }], "meta, facebook and fb all count as Meta ads");
assert.equal(pa.daily.length, 7); assert.deepEqual(pa.daily.at(-1), { date: "2026-10-23", sessions: 4, booked: 1 });
assert.deepEqual(pa.recent.map((r) => r.furthest), ["Opened the page", "Started their details", "Saw the times", "Booked"], "newest first, how far each got");
assert.equal(pageAnalytics([], 30, "America/Chicago").sessions, 0);
ok("page analytics: visits, funnel and biggest drop-off, median time, phone share, Soonest use, scroll depth, sources, days, recent visits");

// Page fonts: Arial by default, unknown keys fall back to it, and the database allows exactly these
const { fontKey, PAGE_FONT_KEYS, DEFAULT_PAGE_FONT } = await import("@/lib/booking/page-font-keys");
assert.equal(DEFAULT_PAGE_FONT, "arial");
assert.equal(fontKey(undefined), "arial"); assert.equal(fontKey("comic-sans"), "arial"); assert.equal(fontKey("nunito"), "nunito");
const migrationFonts = (await import("node:fs")).readFileSync("supabase/migrations/20261105000000_page_font.sql", "utf8").match(/in \(([^)]*)\)/)![1].replace(/'| /g, "").split(",");
assert.deepEqual(migrationFonts, PAGE_FONT_KEYS, "the migration's allowed fonts match the picker");
ok("page fonts: Arial by default, unknown fonts fall back to it, the database allows exactly the picker's fonts");


// Half-star ratings: rounded to the nearest half, 0.5 to 5; the database allows exactly those steps
const { halfStars, ratingText } = await import("@/components/ui/stars");
assert.equal(halfStars(4.5), 4.5); assert.equal(halfStars(4), 4); assert.equal(halfStars(4.7), 4.5); assert.equal(halfStars(4.8), 5);
assert.equal(halfStars(0.5), 0.5); assert.equal(halfStars(0.2), null, "under half a star is no rating");
assert.equal(halfStars(7), 5); assert.equal(halfStars(null), null); assert.equal(halfStars(Number.NaN), null);
assert.equal(ratingText(4.5), "4.5"); assert.equal(ratingText(5), "5");
const halfMigration = (await import("node:fs")).readFileSync("supabase/migrations/20261108000000_half_star_ratings.sql", "utf8");
assert.match(halfMigration, /numeric\(2, 1\)/); assert.match(halfMigration, /rating \* 2 = round\(rating \* 2\)/);
ok("half stars: ratings round to the nearest half (0.5 to 5), whole numbers still work, and the database allows exactly half steps");


// Failed saves: a request that can't complete becomes a message, and typed text is kept
const { friendlyActionError, safely } = await import("@/lib/dashboard/action-errors");
assert.match(friendlyActionError(new Error('Server Action "abc123" was not found on the server.')), /updated while this page was open.*what you typed is kept/i);
assert.match(friendlyActionError(new TypeError("Failed to fetch")), /Couldn't reach Migz.*what you typed is kept/i);
assert.match(friendlyActionError(new Error("boom")), /didn't save.*what you typed is kept/i);
assert.deepEqual(await safely(async () => ({ ok: true as const })), { ok: true }, "a normal result passes through");
assert.deepEqual(await safely(async () => ({ ok: false as const, error: "Add the client's name" })), { ok: false, error: "Add the client's name" }, "a server message passes through");
const failed = await safely(async () => { throw new Error("Server Action x was not found on the server"); });
assert.equal(failed.ok, false); assert.match((failed as { error: string }).error, /Reload the page/);
const { readDraft, writeDraft, clearDraft } = await import("@/lib/dashboard/drafts");
const mem = new Map<string, string>();
const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
writeDraft("testimonial:new", { quote: "Great service" }, fake);
assert.deepEqual(readDraft("testimonial:new", fake), { quote: "Great service" }, "a draft survives a reload");
clearDraft("testimonial:new", fake); assert.equal(readDraft("testimonial:new", fake), null, "and is gone once saved or cancelled");
const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
assert.equal(readDraft("x", blocked), null); writeDraft("x", 1, blocked); clearDraft("x", blocked);
ok("failed saves: stale page, offline and unknown errors become a message that keeps the text, server messages pass through, drafts survive and clear, blocked storage is harmless");


// Error reporting: grouped by problem, noise ignored, a clear Slack message
const ec = await import("@/lib/admin/error-core");
assert.deepEqual(["/dashboard/landing", "/admin", "/miguel-cruz", "/miguel-cruz/prepare", "/", "/privacy", "/login"].map(ec.areaOf), ["dashboard", "admin", "booking page", "booking page", "site", "site", "site"]);
assert.equal(ec.slugOf("/miguel-cruz/prepare"), "miguel-cruz"); assert.equal(ec.slugOf("/dashboard/brain"), null);
const rep = (over: Partial<import("@/lib/admin/error-core").IssueReport> = {}) => ({ kind: "window" as const, path: "/dashboard/landing", message: "Cannot read properties of undefined (reading 'x')", ...over });
assert.equal(ec.issueKey(rep()), ec.issueKey(rep({ path: "/dashboard/landing?tab=testimonials" })), "the query string doesn't make a new problem");
assert.equal(ec.issueKey(rep({ message: 'Server Action "abc123def" was not found' })), ec.issueKey(rep({ message: 'Server Action "zzz999" was not found' })), "ids in a message group together");
assert.equal(ec.issueKey(rep({ message: "Item 4f8d0d5e-1b2c-4d3e-8f9a-0b1c2d3e4f5a failed at 12:03" })), ec.issueKey(rep({ message: "Item 11111111-2222-3333-4444-555555555555 failed at 99:99" })));
assert.notEqual(ec.issueKey(rep()), ec.issueKey(rep({ path: "/dashboard/brain" })), "a different page is a different problem");
assert.notEqual(ec.issueKey(rep()), ec.issueKey(rep({ message: "Something else" })), "a different message is a different problem");
assert.notEqual(ec.issueKey(rep()), ec.issueKey(rep({ kind: "server" })), "a browser error and a server error are kept apart");
assert.ok(ec.issueKey(rep()).startsWith("site_error:dashboard:"));
for (const noise of ["ResizeObserver loop completed with undelivered notifications.", "Script error.", "Non-Error promise rejection captured with value: Object Not Found Matching Id:3", "Loading chunk 123 failed.", "NEXT_REDIRECT", "The user aborted a request."])
  assert.equal(ec.shouldIgnore(rep({ message: noise })), true, noise);
assert.equal(ec.shouldIgnore(rep({ message: "Failed to fetch" })), true, "a dropped connection in the browser isn't a bug");
assert.equal(ec.shouldIgnore(rep({ kind: "action", message: "Failed to fetch" })), false, "but a failed save is reported");
assert.equal(ec.shouldIgnore(rep({ message: "TypeError: x is undefined", stack: "at chrome-extension://abc/content.js:1" })), true, "browser extensions");
assert.equal(ec.shouldIgnore(rep({ path: "/api/errors", kind: "server" })), true, "the reporter never reports itself");
assert.equal(ec.shouldIgnore(rep()), false);
assert.deepEqual([ec.severityOf(rep({ kind: "boundary" })), ec.severityOf(rep({ kind: "server" })), ec.severityOf(rep({ kind: "action" })), ec.severityOf(rep())], ["critical", "critical", "warn", "warn"]);
assert.equal(ec.titleOf(rep({ agentName: "Miguel Cruz" })), "Error in Miguel Cruz's dashboard");
assert.equal(ec.titleOf(rep({ path: "/miguel-cruz", agentName: "Miguel Cruz" })), "Error on Miguel Cruz's booking page");
assert.equal(ec.titleOf(rep({ path: "/admin" })), "Error in the admin dashboard");
assert.equal(ec.titleOf(rep({ path: "/" })), "Error on the site");
const slackMsg = ec.issueSlackMessage(rep({ kind: "boundary", agentName: "Miguel Cruz", agentSlug: "miguel-cruz", message: "Boom <@U123> & <!channel>", digest: "d123", ua: "Safari" }), { appUrl: "https://anryhlabs.com" });
const sj = JSON.stringify(slackMsg.blocks);
assert.match(slackMsg.text, /Error in Miguel Cruz's dashboard: Boom/);
assert.ok(!sj.includes("<@U123>") && !sj.includes("<!channel>") && sj.includes("&lt;@U123&gt;"), "error text can't mention anyone");
assert.match(sj, /The page crashed/); assert.match(sj, /\/dashboard\/landing/); assert.match(sj, /Miguel Cruz \(\/miguel-cruz\)/);
assert.match(sj, /admin\/view\/miguel-cruz\?to=%2Fdashboard%2Flanding/, "a button to see their page as they do");
assert.match(ec.issueSlackMessage(rep(), { appUrl: "https://a.b", reminder: true }).text, /^Still happening: /);
assert.ok(JSON.stringify(ec.issueSlackMessage(rep({ message: "x".repeat(5000) }), { appUrl: "https://a.b" }).blocks).length < 3000, "long messages are cut");
assert.ok(ec.detailOf(rep({ message: "y".repeat(2000) })).length <= 600);
ok("error reporting: same problem groups across ids and query strings, noise (extensions, chunk loads, dropped connections) is ignored, crashes and server errors are critical, Slack message names the agent, can't mention anyone and links to their page");


// Affiliates: 1% credit, refunds take their share back, join form checks, page addresses
const rc = await import("@/lib/referrals-core");
assert.deepEqual([35_000, 70_000, 100_000, 12_345, 0, -500, 1.5].map(rc.referralCreditCents), [350, 700, 1000, 123, 0, 0, 0], "1% of the deposit, rounded to the cent");
assert.deepEqual(rc.reversalShares({ depositCents: 35_000, feeCents: -7_000, creditCents: 350, amountCents: 35_000 }), { refundCents: 35_000, feeBackCents: 7_000, creditBackCents: 350, adMoneyCents: 28_000 }, "a full refund: the agent loses the $280 of ad money, the referrer the $3.50");
assert.deepEqual(rc.reversalShares({ depositCents: 35_000, feeCents: -7_000, creditCents: 350, amountCents: 17_500 }), { refundCents: 17_500, feeBackCents: 3_500, creditBackCents: 175, adMoneyCents: 14_000 }, "half refunded, half reversed");
assert.equal(rc.reversalShares({ depositCents: 35_000, feeCents: -7_000, creditCents: 0, amountCents: 99_999 }).refundCents, 35_000, "never more than the deposit");
assert.equal(rc.reversalShares({ depositCents: 35_000, feeCents: -7_000, creditCents: 350, amountCents: 0 }).creditBackCents, 0);
assert.deepEqual(rc.parseStates("IL, fl / Texas; new york\nXX, Illinois"), ["IL", "FL", "TX", "NY"], "codes and names, unknown dropped, no repeats");
assert.deepEqual(rc.parseStates("IL FL tx"), ["IL", "FL", "TX"]);
assert.deepEqual(rc.parseStates(""), []);
const okJoin = rc.validateJoin({ fullName: "  Jane   Doe ", email: "Jane@Example.COM ", phone: "(312) 555-0100", states: "IL, FL", note: " hi " });
assert.ok(okJoin.ok && okJoin.value.email === "jane@example.com" && okJoin.value.fullName === "Jane Doe" && okJoin.value.note === "hi" && okJoin.value.states.join() === "IL,FL");
const badJoin = rc.validateJoin({ fullName: "J", email: "nope", phone: "123", states: "Narnia" });
assert.ok(!badJoin.ok && badJoin.errors.fullName && badJoin.errors.email && badJoin.errors.phone && badJoin.errors.states, "every bad field says why");
assert.ok(rc.validateJoin({ fullName: "Jane Doe", email: "jane@example.com" }).ok, "phone, states and note are optional");
assert.equal(rc.slugFor("José O'Neil", new Set()), "jose-oneil");
assert.equal(rc.slugFor("Miguel Cruz", new Set(["miguel-cruz", "miguel-cruz-2"])), "miguel-cruz-3", "unique");
assert.equal(rc.slugFor("Join", new Set()), "join-2", "never a path the site uses");
assert.equal(rc.slugFor("!!!", new Set()), "agent");
assert.ok(rc.slugFor("A".repeat(200), new Set()).length <= 48);
const me = { id: "a", email: "Miguel@x.com", stripe_customer_id: "cus_1" };
assert.ok(rc.selfReferral(me, { ...me }), "same agent");
assert.ok(rc.selfReferral({ id: "b", email: "miguel@x.com " }, me), "same email");
assert.ok(rc.selfReferral({ id: "b", email: "b@x.com", stripe_customer_id: "cus_1" }, me), "same card customer");
assert.equal(rc.selfReferral({ id: "b", email: "b@x.com", stripe_customer_id: null }, me), null);
ok("affiliates: 1% of each deposit, refunds and chargebacks take back their share (agent loses only the ad money), join form checks each field, states by code or name, unique page addresses that avoid site paths, no self-referral by id, email or card");


// Call now button: US numbers, and showing only while the agent is open
const call = await import("@/lib/booking/call");
assert.deepEqual(["(312) 555-0100", "312.555.0100", "+1 312 555 0100", "13125550100", "3125550100"].map(call.usPhone), Array(5).fill("+13125550100"));
assert.deepEqual(["555-0100", "0125550100", "1125550100", "44 20 7946 0958", ""].map(call.usPhone), [null, null, null, null, null], "too short, bad area code, not US");
assert.equal(call.displayPhone("+13125550100"), "(312) 555-0100");
const rules = [{ weekday: 1, start_time: "09:00:00", end_time: "17:00:00" }]; // Mondays 9-5
const monAt = (h: number, m = 0) => new Date(`2026-10-26T${String(h + 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`); // Chicago is UTC-5 on Oct 26
assert.equal(call.withinHours(rules, "America/Chicago", monAt(9)), true, "opens at 9");
assert.equal(call.withinHours(rules, "America/Chicago", monAt(16, 59)), true);
assert.equal(call.withinHours(rules, "America/Chicago", monAt(17)), false, "closed at 5");
assert.equal(call.withinHours(rules, "America/Chicago", monAt(8, 59)), false);
assert.equal(call.withinHours(rules, "America/New_York", monAt(9)), true, "10am in New York");
assert.equal(call.withinHours(rules, "America/Chicago", new Date("2026-10-27T15:00:00Z")), false, "Tuesday: no hours");
const ag = { call_button: true, call_phone: "+13125550100", call_hours_only: true, timezone: "America/Chicago" };
assert.equal(call.callButtonShows(ag, rules, monAt(10)), true);
assert.equal(call.callButtonShows(ag, rules, monAt(20)), false, "hidden after hours");
assert.equal(call.callButtonShows({ ...ag, call_hours_only: false }, rules, monAt(20)), true, "always on");
assert.equal(call.callButtonShows({ ...ag, call_button: false }, rules, monAt(10)), false);
assert.equal(call.callButtonShows({ ...ag, call_phone: null }, rules, monAt(10)), false, "no number, no button");
ok("call now: US numbers in any format, bad ones refused, shows only during working hours in the agent's timezone (unless always on), never without a number");


// AI budget paced across the month: today's allowance = what's left ÷ days left
const pace = await import("@/lib/migz/budget-pace");
const d1 = pace.pacedBudget({ limitUsd: 31, monthSpentUsd: 0, todaySpentUsd: 0, daysLeft: 31 });
assert.equal(d1.dailyUsd, 1, "$31 over a 31-day month = $1 a day");
const busy = pace.pacedBudget({ limitUsd: 31, monthSpentUsd: 5, todaySpentUsd: 5, daysLeft: 31 });
assert.equal(busy.dailyUsd, 1, "today's own spend doesn't shrink today's allowance");
assert.equal(busy.dayRatio, 5);
assert.equal(planTier("operator", busy)?.tier, "haiku", "over today's allowance: cheaper models for the rest of the day");
assert.equal(planTier("scout", busy), null, "and optional work stops");
assert.ok(Math.abs(pace.pacedBudget({ limitUsd: 31, monthSpentUsd: 5, todaySpentUsd: 0, daysLeft: 30 }).dailyUsd - 26 / 30) < 1e-9, "a busy day is made up for by smaller days after it");
assert.equal(pace.pacedBudget({ limitUsd: 31, monthSpentUsd: 0, todaySpentUsd: 0, daysLeft: 21 }).dailyUsd, 31 / 21, "quiet days carry forward");
const mid = pace.pacedBudget({ limitUsd: 30, monthSpentUsd: 10.4, todaySpentUsd: 0.4, daysLeft: 20 });
assert.ok(Math.abs(mid.dailyUsd - 1) < 1e-9 && Math.abs(mid.dayRatio - 0.4) < 1e-9);
assert.equal(planTier("operator", mid)?.tier, "sonnet", "within today's share: normal models");
const last = pace.pacedBudget({ limitUsd: 30, monthSpentUsd: 29, todaySpentUsd: 0, daysLeft: 1 });
assert.equal(last.dailyUsd, 1, "the last day gets whatever is left");
const over = pace.pacedBudget({ limitUsd: 30, monthSpentUsd: 31, todaySpentUsd: 0, daysLeft: 5 });
assert.equal(over.dailyUsd, 0);
assert.ok(over.ratio > 1 && planTier("operator", over)?.degraded, "month used up: degraded, as before");
assert.equal(pace.pacedBudget({ limitUsd: Infinity, monthSpentUsd: 3, todaySpentUsd: 3, daysLeft: 9 }).ratio, 0, "no budget (staff tools)");
const w = pace.budgetWindow("America/Chicago", new Date("2026-10-25T04:30:00Z")); // 11:30pm Oct 24 in Chicago
assert.equal(w.daysLeft, 8, "Oct 24 → 8 days left including today");
assert.equal(w.dayStart, "2026-10-24T05:00:00.000Z");
assert.equal(w.monthStart, "2026-10-01T05:00:00.000Z", "the month starts at midnight in the agent's timezone");
ok("AI budget pacing: daily allowance = what's left ÷ days left, a busy day moves Migz to cheaper models until tomorrow, quiet days carry forward, the month still caps it, days and months in the agent's timezone");


// Auditor pacing: expected spend counts from when the ads started, not the 1st of the month
const { pacingExpectation } = await import("@/lib/migz/team/auditor");
const auditAt = new Date("2026-10-25T01:30:00Z"); // 8:30pm Oct 24 in Chicago
const miguel = pacingExpectation({ dailyCents: 2000, startedOn: "2026-10-22", timezone: "America/Chicago", now: auditAt });
assert.ok(Math.abs(miguel.days - (2 + 20.5 / 24)) < 1e-6, "started Oct 22: 2.85 days, not 24");
assert.equal(miguel.expected, 5708, "$20/day × 2.85 days ≈ $57, so $53 spent is on pace");
assert.ok(5324 >= miguel.expected * 0.6, "Miguel's real $53.24 isn't under-delivering");
const fullMonth = pacingExpectation({ dailyCents: 2000, startedOn: "2026-09-10", timezone: "America/Chicago", now: auditAt });
assert.ok(Math.abs(fullMonth.days - (23 + 20.5 / 24)) < 1e-6, "started last month: counted from Oct 1");
assert.equal(pacingExpectation({ dailyCents: 2000, startedOn: null, timezone: "America/Chicago", now: auditAt }).days, fullMonth.days, "unknown start: from the 1st");
assert.equal(pacingExpectation({ dailyCents: 2000, startedOn: "2026-10-30", timezone: "America/Chicago", now: auditAt }).expected, 0, "not started yet: nothing expected");
ok("auditor pacing: expected spend = daily budget × days since the ads started (or the 1st), up to now, so a new account isn't flagged as under-delivering");

// Placements: never the Audience Network or Messenger
const metaAds = await import("@/lib/meta/ads");
assert.deepEqual(metaAds.placementTargeting([]), { publisher_platforms: ["facebook", "instagram"] }, "automatic = Facebook and Instagram only");
assert.deepEqual(metaAds.placementTargeting(["instagram_reels"]), { publisher_platforms: ["instagram"], instagram_positions: ["reels"] });
assert.equal(metaAds.reachesOtherApps(undefined), true, "no targeting = automatic everywhere");
assert.equal(metaAds.reachesOtherApps({ geo_locations: {} }), true, "no platform list = automatic everywhere");
assert.equal(metaAds.reachesOtherApps({ publisher_platforms: ["facebook", "instagram", "audience_network"] }), true);
assert.equal(metaAds.reachesOtherApps({ publisher_platforms: ["facebook", "messenger"] }), true);
assert.equal(metaAds.reachesOtherApps({ publisher_platforms: ["facebook", "instagram"] }), false);
assert.equal(metaAds.reachesOtherApps({ publisher_platforms: ["instagram"] }), false);
ok("placements: automatic means Facebook and Instagram only; any ad set that can reach the Audience Network or Messenger is caught");


// Nightly summary: 9pm in every timezone, the first-week phase, and thoughts carried night to night
const { nightlyDue, phaseOf, mergeThoughts, carryOver, NIGHTLY_HOUR } = await import("@/lib/migz/nightly-core");
const { DateTime: LuxonDT } = await import("luxon");
assert.equal(NIGHTLY_HOUR, 21);
const utcNight = LuxonDT.fromISO("2026-10-25T02:30:00Z"); // 9:30pm in Chicago, 7:30pm in LA, 3:30am in London
const hourIn = (zone: string) => utcNight.setZone(zone).hour;
assert.deepEqual(["America/Chicago", "America/Los_Angeles", "Europe/London"].map((z) => nightlyDue(hourIn(z), null, "2026-10-24")), [true, false, false], "each timezone gets it at its own 9pm");
assert.equal(nightlyDue(21, "2026-10-24", "2026-10-24"), false, "never twice in a day");
assert.equal(nightlyDue(21, "2026-10-23", "2026-10-24"), false, "not the evening after the last one");
assert.equal(nightlyDue(21, "2026-10-22", "2026-10-24"), true, "every other evening");
assert.equal(nightlyDue(21, "2026-10-18", "2026-10-24"), true, "and straight away after a gap");
assert.equal(nightlyDue(20, "2026-10-20", "2026-10-24"), false, "only from 9pm");
assert.equal(phaseOf("2026-10-29", "2026-10-24"), "collecting");
assert.equal(phaseOf("2026-10-29", "2026-10-29"), "revising");
assert.equal(phaseOf(null, "2026-10-24"), "none");
const nt = (id: string, status: "considering" | "testing" | "ready" | "done" | "dropped", text = id) => ({ id, text, kind: "test" as const, status, note: "n" });
const night1 = mergeThoughts([], [nt("", "considering", "Video hooks beat images"), nt("", "testing", "Evening spend converts better")], "2026-10-24");
assert.deepEqual(night1.map((x) => [x.id, x.nights, x.since]), [["t2", 1, "2026-10-24"], ["t1", 1, "2026-10-24"]], "new thoughts get ids and a start date (testing sorts before considering)");
const night2 = mergeThoughts(carryOver(night1), [{ ...nt("t1", "ready", "Video hooks beat images"), note: "hook rate 31% vs 5% link CTR" }, nt("", "considering", "Whole life needs a second video")], "2026-10-25");
const byId = Object.fromEntries(night2.map((x) => [x.id, x]));
assert.equal(byId.t1.nights, 2, "a returned thought counts another night"); assert.equal(byId.t1.since, "2026-10-24", "and keeps its start date");
assert.equal(byId.t2.nights, 2, "a thought the model didn't mention carries over, it isn't forgotten");
assert.equal(byId.t3.since, "2026-10-25", "a blank id is a new thought");
assert.equal(night2[0].status, "ready", "ready thoughts sort first");
const night3 = mergeThoughts(carryOver(night2), [nt("t2", "dropped"), nt("t1", "done")], "2026-10-26");
assert.deepEqual(night3.filter((x) => x.status === "done" || x.status === "dropped").map((x) => x.id).sort(), ["t1", "t2"], "finished and dropped thoughts are reported once");
assert.deepEqual(carryOver(night3).map((x) => x.id), ["t3"], "and then leave the notebook");
const many = mergeThoughts([], Array.from({ length: 9 }, (_, k) => nt("", "considering", `idea ${k}`)), "2026-10-24");
assert.equal(many.filter((x) => x.status === "considering").length, 6, "at most six active thoughts");
assert.equal(mergeThoughts([], [nt("", "considering", "  ")], "2026-10-24").length, 0, "blank thoughts are ignored");

// Page recommendations: specific, numbered, fixes first
const { pageFindings, pageWeekLine } = await import("@/lib/migz/page-findings");
const goodPage = { load: { ok: true, status: 200 }, hasPhoto: true, bioChars: 300, headlineChars: 50, testimonials: 3, requiredSteps: 0, openSlots7d: 40, evenings: true, weekends: true, hasHours: true, week: null };
assert.deepEqual(pageFindings(goodPage), [], "a healthy page has nothing to fix");
const rough = { ...goodPage, load: { ok: false, status: 500 }, hasPhoto: false, testimonials: 0, requiredSteps: 3, openSlots7d: 3, evenings: false, bioChars: 900, headlineChars: 95 };
const found = pageFindings(rough);
assert.deepEqual(found.slice(0, 2).map((f) => f.key), ["page_down", "no_photo"], "outages and missing basics come first");
assert.ok(found.every((f, i, a) => i === 0 || !(f.level === "fix" && a[i - 1].level === "idea")), "fixes before ideas");
assert.match(found.find((f) => f.key === "page_down")!.text, /error 500/);
assert.equal(pageFindings({ ...goodPage, openSlots7d: 0 })[0].key, "no_times");
assert.equal(pageFindings({ ...goodPage, hasHours: false, openSlots7d: 0 })[0].key, "no_hours");
const visits = (w: Partial<NonNullable<typeof goodPage.week>>) => ({ ...goodPage, week: { visits: 40, sawTimes: 36, pickedTime: 20, startedForm: 18, booked: 3, errors: 0, mobileShare: 0.8, medianSeconds: 40, ...w } });
assert.deepEqual(pageFindings(visits({})), [], "decent numbers raise nothing");
assert.equal(pageFindings(visits({ sawTimes: 12 }))[0].key, "few_see_times"); assert.match(pageFindings(visits({ sawTimes: 12 }))[0].text, /30%.*40 visitors/);
assert.equal(pageFindings(visits({ pickedTime: 8 }))[0].key, "few_pick");
assert.equal(pageFindings(visits({ startedForm: 8 }))[0].key, "few_start");
assert.equal(pageFindings(visits({ errors: 3 }))[0].key, "errors");
assert.deepEqual(pageFindings({ ...goodPage, week: { visits: 8, sawTimes: 1, pickedTime: 0, startedForm: 0, booked: 0, errors: 0, mobileShare: 1, medianSeconds: 5 } }), [], "under 20 visits the percentages are noise");
assert.equal(pageWeekLine(visits({})), "Last 7 days: 40 visits · 90% saw the times · 3 booked · 80% on a phone");
assert.equal(pageWeekLine(goodPage), null);

// The Slack message: shape, limits and escaping
const nsb = await import("@/lib/migz/slack-blocks");
const baseNight = {
  dateLabel: "Sat, Oct 24", firstName: "Miguel", phase: "collecting" as const, changesFrom: "Oct 29",
  numbers: { spendCents: 3047, budgetCents: 1892, yesterdaySpendCents: 730, impressions: 1301, reach: 800, linkClicks: 86, ctr: 0.066, bookedCalls: 0, batch: { spentCents: 3777, budgetCents: 28000, day: 2, days: 14 } },
  narrative: { headline: "Day 2: the video is getting its first real views", happened: ["Spent $30.47 across both campaigns", "The final expense video had a 72% hook rate <b>"], budget_read: "Ran over the daily budget; Meta balances it over the week.", next: ["Compare hook rates again tomorrow"], page_note: "" },
  thoughts: [{ id: "t1", text: "Video hooks beat images", kind: "test" as const, status: "testing" as const, note: "72% hook rate vs 5% for the image", since: "2026-10-23", nights: 2 }],
  changes: [], findings: [{ key: "no_photo", level: "fix" as const, text: "Add a photo." }, { key: "no_reviews", level: "idea" as const, text: "Add 2–3 client reviews." }], pageWeekLine: "Last 7 days: 40 visits",
  dashboardUrl: "https://anryhlabs.com",
};
const msg = nsb.nightlySummaryMessage(baseNight);
const mj = JSON.stringify(msg.blocks);
assert.match(msg.text, /Tonight's summary · Sat, Oct 24: Day 2/);
assert.ok(msg.blocks.length <= 50, "Slack allows 50 blocks");
assert.match(mj, /Spent \*\$30\.47\* today \(161% of \$18\.92\/day\)/); assert.match(mj, /day 2 of 14/);
assert.match(mj, /won't change anything until Oct 29/); assert.match(mj, /Video hooks beat images.*testing, summary 2/);
assert.ok(!mj.includes("<b>") && mj.includes("&lt;b&gt;"), "model text is escaped");
assert.match(mj, /Your booking page/); assert.match(mj, /:warning: Add a photo/); assert.match(mj, /:bulb: Add 2/);
assert.match(mj, /Edit my page/);
const revising = JSON.stringify(nsb.nightlySummaryMessage({ ...baseNight, phase: "revising", changes: ["Paced your batch to stay within $280.00"] }).blocks);
assert.match(revising, /What Migz changed today/);
const twoDay = nsb.nightlySummaryMessage({ ...baseNight, phase: "revising", numbers: { ...baseNight.numbers, days: 2 } });
const tj = JSON.stringify(twoDay.blocks);
assert.match(twoDay.text, /Your 2-day summary · Sat, Oct 24/);
assert.match(tj, /Spent \*\$30\.47\* in the last 2 days \(81% of \$18\.92\/day for 2 days\)/); assert.match(tj, /booked from ads in the last 2 days/); assert.match(tj, /What Migz changed in the last 2 days/); assert.match(revising, /Paced your batch/);
assert.match(JSON.stringify(nsb.nightlySummaryMessage({ ...baseNight, phase: "revising", changes: [] }).blocks), /Nothing: the numbers said to leave it alone/);
assert.match(JSON.stringify(nsb.nightlySummaryMessage({ ...baseNight, findings: [] }).blocks), /Nothing to change: your page is in good shape/);
assert.match(JSON.stringify(nsb.nightlySummaryMessage({ ...baseNight, narrative: { ...baseNight.narrative, fallback: true } }).blocks), /notes aren't in this summary/);
const huge = nsb.nightlySummaryMessage({ ...baseNight, thoughts: Array.from({ length: 6 }, (_, k) => ({ ...baseNight.thoughts[0], id: `t${k}`, text: "x".repeat(900), note: "y".repeat(900) })) });
assert.ok(JSON.parse(JSON.stringify(huge.blocks)).every((b: { text?: { text: string } }) => !b.text || b.text.text.length <= 3000), "no block passes Slack's 3,000-character limit");
const { planTier: nightPlan } = await import("@/lib/migz/router");
assert.deepEqual(nightPlan("nightly", { limitUsd: 30, spentUsd: 5, ratio: 0.2 }), { tier: "sonnet", degraded: false });
assert.deepEqual(nightPlan("nightly", { limitUsd: 30, spentUsd: 31, ratio: 1.03 }), { tier: "haiku", degraded: true }, "over the AI budget, tonight's summary still goes out on a cheaper model");
ok("summary: every other evening at each timezone's own 9pm, covering both days; first-week phase, thoughts carry (ids, nights, drop and done reported once, max six), page advice with real numbers, Slack message within limits and escaped");

// Admin health: what raises an alert (and how loud)
const { findIssues } = await import("@/lib/admin/issues");
const hNow = Date.parse("2026-10-22T20:00:00Z");
const healthy = {
  agent: { id: "ag1", slug: "miguel-cruz", name: "Miguel Cruz", mode: "auto", setupDone: true, adAccount: "act_1", slack: true, lastRunAt: "2026-10-22T18:00:00Z" },
  now: hNow,
  testMode: false,
  lastRun: { status: "succeeded", started_at: "2026-10-22T18:00:00Z", error: null },
  batch: { day: 3, days: 14, budgetCents: 28000, spentCents: 4000 },
  meta: {
    error: null,
    accountStatus: 1,
    campaigns: [{ id: "c1", name: "Final expense", effective_status: "ACTIVE", retired: false }, { id: "c0", name: "Old", effective_status: "PAUSED", retired: true }],
    adsets: [{ id: "s1", name: "IL, TX", effective_status: "ACTIVE", retired: false }],
    ads: [{ id: "a1", name: "Leave them memories", effective_status: "ACTIVE", reviewFeedback: null }],
  },
  spend: { todayCents: 430, yesterdayCents: 900 },
  jobs: [],
  modelBudgetRatio: 0.2,
  staleProposals: 0,
};
const keys = (h: typeof healthy) => findIssues(h).map((i) => `${i.severity}:${i.key.split(":")[0]}`);
assert.deepEqual(keys(healthy), [], "a healthy account raises nothing (a retired campaign being paused is expected)");
assert.deepEqual(keys({ ...healthy, meta: { ...healthy.meta, accountStatus: 3 } }), ["critical:account_status"]);
assert.match(findIssues({ ...healthy, meta: { ...healthy.meta, accountStatus: 3 } })[0].title, /unsettled/);
assert.deepEqual(keys({ ...healthy, meta: { ...healthy.meta, error: "Error validating access token" } }), ["critical:meta_error"]);
assert.deepEqual(keys({ ...healthy, meta: { ...healthy.meta, campaigns: [{ ...healthy.meta.campaigns[0], effective_status: "PAUSED" }] } }), ["warn:campaign_paused"], "a live campaign paused mid-batch");
assert.deepEqual(keys({ ...healthy, testMode: true, meta: { ...healthy.meta, campaigns: [{ ...healthy.meta.campaigns[0], effective_status: "PAUSED" }] } }), [], "test mode pauses everything on purpose");
assert.deepEqual(keys({ ...healthy, meta: { ...healthy.meta, ads: [{ id: "a1", name: "x", effective_status: "DISAPPROVED", reviewFeedback: "Financial claims" }] } }), ["critical:no_ads", "critical:ad_rejected"]);
assert.match(findIssues({ ...healthy, meta: { ...healthy.meta, ads: [{ id: "a1", name: "x", effective_status: "DISAPPROVED", reviewFeedback: "Financial claims" }] } })[1].detail, /Financial claims/);
assert.deepEqual(keys({ ...healthy, meta: { ...healthy.meta, ads: [healthy.meta.ads[0], { id: "a2", name: "old video", effective_status: "PAUSED", reviewFeedback: null }] } }), ["info:ads_paused"], "paused ads are listed quietly");
assert.deepEqual(keys({ ...healthy, meta: { ...healthy.meta, ads: [{ id: "a1", name: "new", effective_status: "PENDING_REVIEW", reviewFeedback: null }] } }), [], "ads still in Meta's review aren't a problem");
assert.deepEqual(keys({ ...healthy, spend: { todayCents: 0, yesterdayCents: 0 } }), ["warn:not_spending"]);
assert.deepEqual(keys({ ...healthy, batch: { ...healthy.batch, day: 1 }, spend: { todayCents: 0, yesterdayCents: 0 } }), [], "day 1 can be quiet");
assert.deepEqual(keys({ ...healthy, batch: { ...healthy.batch, spentCents: 29000 } }), ["critical:overspend"]);
assert.deepEqual(keys({ ...healthy, agent: { ...healthy.agent, lastRunAt: "2026-10-22T08:00:00Z" } }), ["warn:review_overdue"]);
assert.deepEqual(keys({ ...healthy, jobs: [{ id: "j1", stage: "meta_processing", updated_at: "2026-10-22T18:30:00Z", brief: "Plan ahead" }] }), ["warn:job_stuck"]);
assert.deepEqual(keys({ ...healthy, jobs: [{ id: "j1", stage: "generating", updated_at: "2026-10-22T19:30:00Z", brief: "Plan ahead" }] }), [], "a 30-minute generation is normal");
assert.deepEqual(keys({ ...healthy, modelBudgetRatio: 1.05 }), ["warn:model_budget"]);
assert.deepEqual(keys({ ...healthy, agent: { ...healthy.agent, adAccount: null }, meta: null }), ["critical:meta_missing"]);
assert.deepEqual(keys({ ...healthy, agent: { ...healthy.agent, adAccount: null, mode: "off" }, meta: null }), ["info:meta_missing", "info:migz_off"], "quiet when Migz is off anyway");
assert.deepEqual(keys({ ...healthy, agent: { ...healthy.agent, slack: false } }), ["info:no_slack"]);
assert.equal(new Set(findIssues({ ...healthy, meta: { ...healthy.meta, ads: [{ id: "a1", name: "x", effective_status: "DISAPPROVED", reviewFeedback: null }, { id: "a2", name: "y", effective_status: "DISAPPROVED", reviewFeedback: null }] } }).map((i) => i.key)).size, 3, "each rejected ad is its own alert");
ok("admin health: account can't spend, Meta errors, paused campaigns mid-batch (not in test mode), rejected ads, no ads, not spending, overspend, reviews stopped, stuck creatives, AI budget, missing Meta or Slack");

// Live monitor: a check-in every 10 minutes while the Brain is open, never during a review
const { pulseDue, PULSE_EVERY_MIN } = await import("@/lib/migz/live");
const { isPulse } = await import("@/lib/migz/brain-types");
const t0 = Date.parse("2026-10-22T18:00:00Z");
assert.equal(PULSE_EVERY_MIN, 10);
assert.equal(pulseDue(null, false, t0), true, "first check-in runs straight away");
assert.equal(pulseDue(null, true, t0), false, "never while a review is running");
assert.equal(pulseDue("2026-10-22T17:52:00Z", false, t0), false, "8 minutes after the last one: not yet");
assert.equal(pulseDue("2026-10-22T17:50:00Z", false, t0), true, "10 minutes after: due");
assert.equal(isPulse({ evidence: { kind: "pulse" } }), true);
assert.equal(isPulse({ evidence: {} }), false);
ok("live monitor: check-ins every 10 minutes, none during a review; Sonnet notes stop near the model budget");

// Booking-page funnel: ad visitors only, and a verdict on whether the ads or the page needs the work
const { adFunnel, funnelVerdict } = await import("@/lib/migz/funnel");
const fev = (sid: string, name: string, meta: Record<string, unknown> | null = null) => ({ session_id: sid, name, meta, created_at: "2026-10-26T15:00:00Z" });
const funnelRows = [
  fev("a", "view", { source: "meta" }), fev("a", "see_calendar"), fev("a", "pick_time"), fev("a", "form_start"), fev("a", "submit"), fev("a", "booked"),
  fev("b", "view", { source: "facebook" }), fev("b", "see_calendar"), fev("b", "call_click"),
  fev("c", "view", { source: "direct" }), fev("c", "see_calendar"), fev("c", "booked"),
];
const af = adFunnel(funnelRows, 14, "America/Chicago", new Date("2026-10-27T00:00:00Z"));
assert.deepEqual(af, { visits: 2, sawTimes: 2, pickedTime: 1, startedForm: 1, pressedConfirm: 1, booked: 1, tappedCall: 1, quoteRequests: 0, errors: 0 }, "only visits from Meta ads count");
const F = (o: Partial<typeof af>) => ({ visits: 0, sawTimes: 0, pickedTime: 0, startedForm: 0, pressedConfirm: 0, booked: 0, tappedCall: 0, quoteRequests: 0, errors: 0, ...o });
// Miguel's week: people reach the times and stop there
const miguelFunnel = funnelVerdict(F({ visits: 224, sawTimes: 175, pickedTime: 1 }), 260);
assert.equal(miguelFunnel.stage, "no_time_picked"); assert.equal(miguelFunnel.fix, "page");
assert.match(miguelFunnel.text, /175 of 224 .* only 1 picked one/);
assert.equal(funnelVerdict(F({ visits: 8, sawTimes: 6 })).fix, "ads", "too few visits: the ads come first");
assert.equal(funnelVerdict(F({ visits: 8 }), 60).stage, "clicks_not_arriving", "60 clicks but 8 visits: the page isn't being reached");
assert.equal(funnelVerdict(F({ visits: 40, sawTimes: 12 })).fix, "both", "most leave before the times");
assert.equal(funnelVerdict(F({ visits: 40, sawTimes: 30, pickedTime: 12, startedForm: 4 })).stage, "form_not_started");
assert.equal(funnelVerdict(F({ visits: 40, sawTimes: 30, pickedTime: 12, startedForm: 10, pressedConfirm: 3 })).stage, "form_not_finished");
assert.equal(funnelVerdict(F({ visits: 20, sawTimes: 10, pickedTime: 3, startedForm: 0 })).stage, "no_clear_drop", "3 picks is too few to judge the form");
assert.equal(funnelVerdict(F({ visits: 40, sawTimes: 30, errors: 2 })).stage, "booking_errors", "errors come first");
const booking = funnelVerdict(F({ visits: 40, sawTimes: 30, pickedTime: 10, startedForm: 8, pressedConfirm: 6, booked: 4 }));
assert.equal(booking.fix, "none"); assert.match(booking.text, /4 of 40 ad visitors booked \(10%\)/);
assert.match(funnelVerdict(F({ visits: 224, sawTimes: 175, pickedTime: 1, tappedCall: 3 })).text, /3 tapped Call instead/);
assert.match(funnelVerdict(F({ visits: 40, sawTimes: 35, pickedTime: 1, quoteRequests: 4 })).text, /4 asked for a quote instead/);
ok("booking-page funnel: ad visits only; page vs ads verdicts (times, form, errors, clicks not arriving, too few visits)");

// The strategist's playbook: budget math decides the structure, more money is advised from the account's own cost per call
const { budgetMath, scaleAdvice, ownCostPerCall, PLAYBOOK } = await import("@/lib/migz/playbook");
const split = budgetMath({ dailyCents: 1810, adsets: 3, costPerCallCents: null });
assert.equal(split.verdict, "consolidate", "Miguel's $18.10/day across 3 ad sets");
assert.equal(split.costSource, "estimate");
assert.match(split.text, /\$18\/day at about \$60 per booked call .* about 2\.1 booked calls a week\. Split across 3 ad sets that's about \$6\/day and 0\.7 a week each/);
const oneSet = budgetMath({ dailyCents: 2000, adsets: 1, costPerCallCents: null });
assert.equal(oneSet.verdict, "keep"); assert.match(oneSet.text, /One ad set gets all of it/);
assert.equal(oneSet.learningDailyCents, 42857, "one ad set needs about $429/day to reach 50 calls a week at $60");
assert.equal(ownCostPerCall(12000, 2), null, "2 bookings is too few to trust"); assert.equal(ownCostPerCall(15000, 3), 5000);
assert.equal(budgetMath({ dailyCents: 2000, adsets: 1, costPerCallCents: 5000 }).costSource, "account");
assert.equal(scaleAdvice({ spentCents: 10000, bookedCalls: 1, extraCents: 28000 }), null);
assert.match(scaleAdvice({ spentCents: 15000, bookedCalls: 3, extraCents: 28000 })!.text, /At your \$50 per booked call, another \$280 of ad spend should bring about 5\.6 more booked calls/);
assert.match(PLAYBOOK, /never treat a lower spend as a result/);

// restructure: only a split account with a running batch and time left to learn
const { checkRestructure } = await import("@/lib/migz/guardrails");
const rset = (id: string, role = "main", status = "ACTIVE") => ({ meta_adset_id: id, status, role, daily_budget_cents: 600, learning_status: "LEARNING", last_edited_at: "2026-10-25T00:00:00Z", ads: [] });
const rctx = (adsets: ReturnType<typeof rset>[], batchDaysLeft: number | null | undefined) => ({ ...gctx, adsets, batchDaysLeft });
assert.equal(checkRestructure(rctx([rset("a"), rset("b"), rset("c")], 9)), null, "3 live main ad sets, 9 days left: restructure");
assert.match(checkRestructure(rctx([rset("a"), rset("x", "explore")], 9)) ?? "", /already runs one main ad set/, "exploration doesn't count as a split");
assert.match(checkRestructure(rctx([rset("a"), rset("b", "main", "PAUSED")], 9)) ?? "", /already runs one main ad set/);
assert.match(checkRestructure(rctx([rset("a"), rset("b")], 3)) ?? "", /Only 3 days left/);
assert.match(checkRestructure(rctx([rset("a"), rset("b")], null)) ?? "", /isn't one with an end date/);
const rs = evalTool("restructure", { title: "Fold into one ad set", reason: "3 ad sets can't each learn on $18/day" }, { ...rctx([rset("a"), rset("b")], 9), scriptedAds: new Map(), libraryCreativeIds: new Set<string>() });
assert.ok(rs.ok && rs.payload.tool === "restructure" && rs.kind === "budget");
ok("strategist: budget math (consolidate a split budget, own cost per call after 3 bookings), scale advice, restructure guardrail");

// The ad finder: overnight passes, every topic and platform, only ads with evidence they're winning
const finder = await import("@/lib/migz/team/finder");
assert.equal(finder.FINDER_DAILY_USD, 5);
assert.equal(finder.finderWindow(new Date("2026-10-27T07:30:00Z")), true, "2:30am Central: searching");
assert.equal(finder.finderWindow(new Date("2026-10-27T11:30:00Z")), false, "6:30am Central: done for the night");
assert.equal(finder.finderWindow(new Date("2026-10-27T05:30:00Z")), false, "12:30am Central: not yet");
const night = new Date("2026-10-27T07:00:00Z");
const pairs = new Set(Array.from({ length: 32 }, (_, k) => { const q = finder.finderQuery(k, night); return `${q.topic}|${q.platform}`; }));
assert.equal(pairs.size, 32, "32 passes cover every topic on every platform");
assert.notDeepEqual(finder.finderQuery(0, night), finder.finderQuery(0, new Date("2026-10-28T07:00:00Z")), "each night starts somewhere new");
const findTraits = { angle: "a", hook_type: "story", opening_image: "i", emotional_tone: "warm", setting: "home", text_legibility: "clear", claims: [], compliance_risk: "low", format: "reel", offer: "free call" };
const finds = finder.parseFinds(`notes <finds>{"finds":[
  {"source_url":"https://example.com/a","platform":"TikTok","advertiser":"X","description":"A daughter finds a note","win_evidence":"Ran 74 days","win_score":3,"traits":${JSON.stringify(findTraits)}},
  {"source_url":"https://example.com/b","platform":"Meta","advertiser":"Y","description":"Stock family","win_evidence":"shown as an example","win_score":1,"traits":${JSON.stringify(findTraits)}},
  {"source_url":"not a url","platform":"Meta","advertiser":"Z","description":"d","win_evidence":"30 days","win_score":2,"traits":${JSON.stringify(findTraits)}}
]}</finds>`);
assert.deepEqual(finds.map((f) => f.source_url), ["https://example.com/a"], "no evidence or no real link: not filed");
assert.deepEqual(finder.parseFinds("no tags here"), []);
assert.deepEqual(finder.parseFinds("<finds>{bad json</finds>"), []);
ok("ad finder: overnight window, every topic and platform, only ads with evidence they're winning, $5/day");

// --- "Get a free quote" requests
const { parseQuote } = await import("@/lib/booking/validate");
const q1 = parseQuote({ slug: "miguel-cruz", name: " Ana Ruiz ", phone: "(312) 555-0199", coverage: "Final expense", bestTime: "Evening", consent: true, attribution: { utm_content: "plan-ahead", "bad key!": "x" } });
assert.ok(q1.ok);
assert.deepEqual(q1.data, { slug: "miguel-cruz", name: "Ana Ruiz", phone: "+13125550199", coverage: "Final expense", bestTime: "Evening", attribution: { utm_content: "plan-ahead" } });
const q2 = parseQuote({ name: "Ana", phone: "3125550199", coverage: "Annuity", bestTime: "3am", consent: true });
assert.ok(q2.ok && q2.data.coverage === null && q2.data.bestTime === null, "picks outside our lists are dropped, not rejected");
const q3 = parseQuote({ name: "Ana", phone: "555-0199", consent: true });
assert.ok(!q3.ok && /phone/.test(q3.error));
const q4 = parseQuote({ name: "Ana", phone: "3125550199" });
assert.ok(!q4.ok && /agree/.test(q4.error), "consent is required");
const q5 = parseQuote({ name: "Ana", phone: "3125550199", consent: true, company: "Acme" });
assert.ok(!q5.ok && q5.bot, "honeypot");
const qa = pageAnalytics([
  { session_id: "s1", name: "view", meta: { source: "facebook" }, created_at: new Date(Date.now() - 60_000).toISOString() },
  { session_id: "s1", name: "quote_open", meta: null, created_at: new Date(Date.now() - 50_000).toISOString() },
  { session_id: "s1", name: "quote_submit", meta: null, created_at: new Date(Date.now() - 40_000).toISOString() },
  { session_id: "s2", name: "view", meta: { source: "facebook" }, created_at: new Date(Date.now() - 30_000).toISOString() },
], 7, "America/Chicago");
assert.equal(qa.extras.quoteVisits, 1);
assert.equal(qa.booked, 0, "a quote request is never counted as a booking");
ok("quote requests: parse, consent, honeypot, counted apart from bookings");

// The conversion path: Migz's own calls on the quote option and what Meta optimizes for
const { adsForBudget } = await import("@/lib/migz/playbook");
assert.deepEqual([1866, 2000, 3000, 5000, 20000].map(adsForBudget), [3, 3, 4, 6, 6], "about $50 a week per live ad, 3 to 6");
assert.match(budgetMath({ dailyCents: 5000, adsets: 1, costPerCallCents: null }).text, /gives 6 live ads about \$50 a week each/);
const { checkQuoteMode, checkOptimizationEvent } = await import("@/lib/migz/guardrails");
const lset = (over: Record<string, unknown> = {}) => ({ meta_adset_id: "s1", status: "ACTIVE", daily_budget_cents: 5000, learning_status: null, last_edited_at: "2026-10-01T00:00:00Z", ads: [], ...over });
const lctx = (over: Record<string, unknown> = {}) => ({ now: new Date("2026-10-27T12:00:00Z"), dailyCapCents: 5000, adsets: [lset()], actionsThisRun: 0, generationsThisRun: 0, openGenerations: 0, batchDaysLeft: 10, quoteMode: "folded" as const, bookedLast7: 0, pageFunnel: { visits: 48, pickedTime: 2, booked: 0 }, ...over });
assert.equal(checkQuoteMode(lctx(), "open_for_ads"), null, "48 ad visitors, 0 booked: open the lighter step");
assert.match(checkQuoteMode(lctx({ pageFunnel: { visits: 12, pickedTime: 0, booked: 0 } }), "open_for_ads")!, /too few/);
assert.match(checkQuoteMode(lctx({ pageFunnel: { visits: 40, pickedTime: 10, booked: 4 } }), "open_for_ads")!, /booking works/);
assert.match(checkQuoteMode(lctx(), "folded")!, /already folded/);
assert.match(checkQuoteMode(lctx({ pageFunnel: { visits: 60, pickedTime: 10, booked: 6 }, adsets: [lset({ optimization_event: "LEAD" })] }), "off")!, /optimizes for leads/);
assert.equal(checkQuoteMode(lctx({ pageFunnel: { visits: 60, pickedTime: 10, booked: 6 } }), "off"), null);
assert.match(checkQuoteMode(lctx(), "sideways")!, /must be one of/);
assert.equal(checkOptimizationEvent(lctx(), "s1", "LEAD"), null, "0 bookings a week on SCHEDULE: switch to LEAD");
assert.equal(checkOptimizationEvent(lctx({ now: new Date("2026-10-01T01:00:00Z") }), "s1", "LEAD"), null, "same sitting as the last change");
assert.match(checkOptimizationEvent(lctx({ now: new Date("2026-10-02T12:00:00Z") }), "s1", "LEAD")!, /wait until 3 days/);
assert.match(checkOptimizationEvent(lctx({ batchDaysLeft: 2 }), "s1", "LEAD")!, /2 days left/);
assert.match(checkOptimizationEvent(lctx({ quoteMode: "off" }), "s1", "LEAD")!, /quote option is off/);
assert.match(checkOptimizationEvent(lctx({ bookedLast7: 12 }), "s1", "LEAD")!, /keep SCHEDULE/);
assert.match(checkOptimizationEvent(lctx({ adsets: [lset({ optimization_event: "LEAD" })] }), "s1", "SCHEDULE")!, /needs about 10 a week/);
assert.equal(checkOptimizationEvent(lctx({ adsets: [lset({ optimization_event: "LEAD" })], bookedLast7: 11 }), "s1", "SCHEDULE"), null);
assert.match(checkOptimizationEvent(lctx(), "s1", "SCHEDULE")!, /already optimizes/);
const qctx = { ...lctx(), scriptedAds: new Map(), libraryCreativeIds: new Set<string>() };
const qe = evalTool("set_quote_option", { mode: "open_for_ads", title: "Opened the quote option for ad visitors", reason: "42 of 48 saw the times, 2 picked one" }, qctx);
assert.ok(qe.ok && qe.payload.tool === "set_quote_option" && qe.payload.mode === "open_for_ads");
const oe = evalTool("set_optimization_event", { adset_id: "s1", event: "LEAD", title: "Optimizing for leads", reason: "0 bookings a week" }, qctx);
assert.ok(oe.ok && oe.payload.tool === "set_optimization_event" && oe.payload.event === "LEAD");
const { signalAdvice } = await import("@/lib/migz/routines");
const sig = (over: Record<string, unknown> = {}) => signalAdvice({ adsets: [lset()] as never, bookedLast7: 0, quoteMode: "folded", pageIsTheBottleneck: true, ...over });
assert.equal(sig()?.subject, "lead"); assert.match(sig()!.text, /spending blind.*open the quote option/);
assert.equal(sig({ adsets: [lset({ optimization_event: "LEAD" })] })?.subject, "quote", "already on LEAD, page still stalls");
assert.equal(sig({ adsets: [lset({ optimization_event: "LEAD" })], quoteMode: "open_for_ads" }), null, "both done");
assert.equal(sig({ adsets: [lset({ optimization_event: "LEAD" })], bookedLast7: 10 })?.subject, "schedule");
ok("conversion path: ads per budget, quote option and optimization event guardrails, the strategist's signal advice");

// --- One-week sprint and Keep going
const { batchOptions: bopts, findOption: fopt, recommendOption: recOpt, SPRINT_MIN_BATCH_CENTS } = await import("@/lib/batch");
const at700 = bopts(70_000, ["final_expense"]);
const sprint700 = at700.find((o) => o.key === "sprint")!;
assert.ok(sprint700, "$700 offers a one-week sprint");
assert.deepEqual([sprint700.days, sprint700.dailyCents, sprint700.perCampaignCents, sprint700.exploreCents, sprint700.collectDays], [7, 10_000, 10_000, 0, 3], "$100/day for 7 days, read for 3 days");
assert.deepEqual(at700.filter((o) => o.key !== "sprint").map((o) => [o.key, o.days]), [["focused", 35], ["explore", 14]], "the longer plans are unchanged");
assert.ok(at700.filter((o) => o.key !== "sprint").every((o) => o.collectDays === 7), "other plans still collect for 7 days");
assert.equal(bopts(SPRINT_MIN_BATCH_CENTS, ["final_expense"]).some((o) => o.key === "sprint"), true, "$350 is $50/day for a week");
assert.equal(bopts(SPRINT_MIN_BATCH_CENTS - 100, ["final_expense"]).some((o) => o.key === "sprint"), false, "under $50/day a week reads too thin");
assert.equal(fopt(70_000, ["final_expense"], "sprint")?.days, 7, "the server re-derives the sprint from the budget");
assert.notEqual(recOpt(at700, ["final_expense"], { spentCents: 0, bookedCalls: 0, batches: 0, byTopic: {} }).key, "sprint", "Migz never recommends the sprint on its own");
const { renewalGate, RENEW_WINDOW_DAYS } = await import("@/lib/renew-core");
const rnow = new Date("2026-11-04T10:00:00Z");
const rbatch = (over: Record<string, unknown> = {}) => ({ renew: true, status: "ended", ended_at: "2026-11-04T05:00:00Z", budget_cents: 70_000, result: { spent_cents: 61_000 }, ...over });
const ragent = (over: Record<string, unknown> = {}) => ({ ads_paused: false, migz_mode: "auto", hasMeta: true, onboarded: true, focusCount: 1, ...over });
const gate = (b: Record<string, unknown> = {}, a: Record<string, unknown> = {}, balanceCents = 70_000) => renewalGate({ batch: rbatch(b) as never, agent: ragent(a), balanceCents, now: rnow });
assert.deepEqual(gate(), { action: "renew" }, "ended, delivered, balance covers it");
assert.equal(gate({ renew: false }).action, "skip");
assert.equal(gate({ status: "active" }).action, "skip");
const short = gate({}, {}, 52_000);
assert.ok(short.action === "wait" && /\$520, \$180 short of the \$700/.test(short.reason) && /Add about \$225 in funds/.test(short.reason), "waits for funds and says how much (with the 20% fee)");
assert.equal(gate({}, { ads_paused: true }).action, "wait");
assert.equal(gate({}, { migz_mode: "off" }).action, "wait");
const dead = gate({ result: { spent_cents: 20_000 } });
assert.ok(dead.action === "stop" && /spent only \$200 of its \$700/.test(dead.reason), "ads that didn't deliver aren't repeated");
assert.equal(gate({ ended_at: "2026-10-30T10:00:00Z" }).action, "stop", `gives up ${RENEW_WINDOW_DAYS} days after the batch ended`);
assert.equal(gate({}, { focusCount: 0 }).action, "stop");
const { batchRenewedMessage, batchRenewBlockedMessage } = await import("@/lib/migz/slack-blocks");
assert.match(batchRenewedMessage({ budgetCents: 70_000, days: 7, dailyCents: 10_000, balanceCents: 12_500, dashboardUrl: "https://x.test" }).text, /next 7-day batch started \(\$700\)/);
assert.match(JSON.stringify(batchRenewBlockedMessage({ reason: "short", stopped: true, dashboardUrl: "https://x.test" }).blocks), /Keep going stopped/);
ok("one-week sprint and Keep going: sprint from $350, $700 = $100/day for 7 days read for 3, never recommended, renewal gate (funds, paused, dead ads, 3-day window), Slack notices");

// Agents whose page lives on their agency's site: ads link there; partner page URLs are trusted only on those sites
const sites = await import("@/lib/booking/sites");
assert.equal(sites.landingUrl("miguel-cruz", "https://anryhlabs.com"), "https://foreignfinancial.org/miguel-cruz");
assert.equal(sites.landingUrl("someone-else", "https://anryhlabs.com/"), "https://anryhlabs.com/someone-else");
assert.equal(sites.partnerPageUrl("https://foreignfinancial.org/miguel-cruz?utm_source=meta"), "https://foreignfinancial.org/miguel-cruz");
assert.equal(sites.partnerPageUrl("https://evil.example/miguel-cruz"), null);
assert.equal(sites.partnerPageUrl("http://foreignfinancial.org/miguel-cruz"), null, "https only");
ok("partner sites: ads link to the agency page, and only partner pages are reported to Meta");

// --- Seedance video and the logo end card
const { videoRequest, videoCostUsd, videoModel } = await import("@/lib/higgsfield");
const vbrief = { concept: "a dad planning ahead", style: "Warm, natural light", hook_line: "Plan ahead", hook_shot: "A dad at a kitchen table", body_shots: [{ prompt: "He closes a folder", duration: 6 }, { prompt: "The kids run in", duration: 6 }], primary_text: "x", headline: "y", cast: "a dad in his late 30s", setting: "a family kitchen", mood: "hopeful", voiceover: "Plan ahead so they never have to." } as never;
delete process.env.HF_VIDEO_MODEL;
assert.equal(videoModel(), "seedance", "Seedance unless HF_VIDEO_MODEL says kling");
const sd = videoRequest(vbrief);
assert.equal(sd.path, "/bytedance/seedance-2.5/text-to-video");
assert.deepEqual([sd.body.duration, sd.body.resolution, sd.body.aspect_ratio, sd.body.output_format, sd.body.generate_audio], [15, "720p", "9:16", "mp4", true], "a 15s 720p 9:16 reel by default");
assert.match(String(sd.body.prompt), /Shot 1 \(0–3s\).*\nShot 2 \(3–9s\).*\nShot 3 \(9–15s\)/, "one prompt that times its shots");
assert.doesNotMatch(String(sd.body.prompt), /narrator|Plan ahead so they never/, "the narrator is mixed in afterwards, so the model isn't asked to voice it");
assert.equal("multi_prompt" in sd.body, false);
assert.equal(videoCostUsd(vbrief), 6.45, "15 seconds of 720p at the measured $0.43 a second");
process.env.HF_VIDEO_RESOLUTION = "1080p";
assert.equal(videoRequest(vbrief).body.resolution, "1080p"); assert.equal(videoCostUsd(vbrief), 13.2, "1080p is about twice that");
process.env.HF_VIDEO_RESOLUTION = "480p";
assert.equal(videoCostUsd(vbrief), null, "no rate known for a resolution we haven't measured");
delete process.env.HF_VIDEO_RESOLUTION;
process.env.HF_VIDEO_MODEL = "kling";
const kl = videoRequest(vbrief);
assert.match(kl.path, /kling/); assert.equal((kl.body.multi_prompt as unknown[]).length, 3); assert.equal(videoCostUsd(vbrief), null);
delete process.env.HF_VIDEO_MODEL;
const { endCardFilter, cardFilter, addEndCard, END_CARD_SECONDS } = await import("@/lib/migz/endcard");
const ecf = endCardFilter(15, 1080, 1920);
assert.match(ecf, /clip\(\(t-12\.000\)\/2,0,1\)/, "the pull-back starts 3s before the end");
assert.match(ecf, /fade=t=out:st=12\.500:d=1\.4:alpha=1/, "the scene dissolves into the blur");
assert.match(ecf, /fade=t=in:st=13\.200:d=0\.8:alpha=1/, "the logo fades in as it does, and holds to the end");
assert.match(ecf, /scale=692:692/, "the logo card is about 64% of the frame's width");
assert.equal(END_CARD_SECONDS, 3);
assert.match(cardFilter(692), /color=c=white.*overlay=.*geq=.*hypot/, "a white card with rounded corners, so a transparent logo is readable");
const { execFileSync: ffRun } = await import("node:child_process");
const ffBin = (await import("ffmpeg-static") as unknown as { default: string }).default;
const { mkdtempSync, readFileSync: readF, rmSync } = await import("node:fs");
const ecDir = mkdtempSync("/tmp/endcard-test-");
ffRun(ffBin, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=15:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", `${ecDir}/s.mp4`]);
ffRun(ffBin, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=white:size=200x200:duration=1", "-frames:v", "1", `${ecDir}/l.png`]);
const withCard = await addEndCard(readF(`${ecDir}/s.mp4`), readF(`${ecDir}/l.png`));
assert.ok(withCard && withCard.length > 1000, "a real render comes back");
ffRun(ffBin, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x0a5c32@0.0:size=300x200:duration=1,format=rgba", "-frames:v", "1", `${ecDir}/t.png`]);
assert.ok((await addEndCard(readF(`${ecDir}/s.mp4`), readF(`${ecDir}/t.png`)))!.length > 1000, "a transparent, non-square logo renders too");
ffRun(ffBin, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=15:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", `${ecDir}/short.mp4`]);
const shortIn = readF(`${ecDir}/short.mp4`);
assert.equal((await addEndCard(shortIn, readF(`${ecDir}/l.png`)))?.length, shortIn.length, "a video too short to zoom out of is left as it is");
rmSync(ecDir, { recursive: true, force: true });
ok("Seedance 2.5 video request (15s 720p 9:16 by default, 1080p a setting, timed shots, no narration, measured cost) with Kling as a setting; logo end card (last 3s, blur and pull-back, logo fades in, real render)");

console.log(`\nALL ${n} UNIT GROUPS PASSED`);
