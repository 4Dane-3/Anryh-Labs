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
ok("quiet gate: skips small changes; runs on bookings, 1,000+ impressions, status changes, manual, daily, audit");

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
const { allocateCampaigns, campaignCount, campaignLabels, perCampaignCents, adSpendCents, depositFor, MIN_DEPOSIT_CENTS, MIN_AD_BALANCE_CENTS } = await import("@/lib/campaign");
assert.deepEqual([campaignCount(2000), campaignCount(3000), campaignCount(4500), campaignCount(500), campaignCount(100_000)], [2, 3, 4, 1, 6]);
const three = ["final_expense", "mortgage_protection", "income_protection"] as const;
assert.deepEqual(allocateCampaigns(three, 2), ["final_expense", "mortgage_protection"], "budget for 2: the top 2 focuses");
assert.deepEqual(allocateCampaigns(three, 3), [...three], "budget for 3 with 3 focuses: one each, no doubling up");
assert.deepEqual(allocateCampaigns(three, 4), ["final_expense", "mortgage_protection", "income_protection", "final_expense"], "4: the main focus gets the second");
assert.deepEqual(allocateCampaigns(three, 5).filter((t) => t === "mortgage_protection").length, 2, "5: then focus 2");
assert.deepEqual(allocateCampaigns(["final_expense"], 2), ["final_expense", "final_expense"]);
assert.deepEqual(allocateCampaigns([], 2), [null, null]);
assert.deepEqual(campaignLabels(allocateCampaigns(three, 4)), ["Final expense A", "Mortgage protection", "Income protection", "Final expense B"]);
assert.equal(perCampaignCents(2500, 2), 1250);
assert.equal(adSpendCents(MIN_DEPOSIT_CENTS), 28_000); assert.equal(MIN_AD_BALANCE_CENTS, 28_000);
assert.equal(depositFor(28_000), 35_000); assert.equal(depositFor(42_000), 52_500);
ok("$10/day per campaign; one per focus while the budget covers them, extras follow the focus order; $350 deposit = $280 of ads after the 20% fee");

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
assert.match(placementCheck(early, "A") ?? "", /first week/);
assert.equal(placementCheck({ ...gctx, revisionsFrom: new Date("2026-10-19T05:00:00Z") }, "A"), null);
ok("pauses, budget and placement edits wait for the campaign's first 7 days of results");

// campaign batches
const { batchOptions, recommendOption, outcomeEstimate, bestTopic, findOption, MIN_BATCH_CENTS } = await import("@/lib/batch");
const noHistory = { spentCents: 0, bookedCalls: 0, batches: 0, byTopic: {} };
assert.equal(batchOptions(MIN_BATCH_CENTS - 100, ["final_expense"]).length, 0, "under the minimum there are no options");
const min2 = batchOptions(28_000, ["final_expense", "mortgage_protection"]);
assert.deepEqual(min2.map((o) => [o.key, o.campaigns.length, o.days, o.perCampaignCents]), [["focused", 1, 14, 2000], ["balanced", 2, 14, 1000]], "$280: focused $20/day, or 2 × $10/day, both 2 weeks; spread adds nothing");
const big = batchOptions(70_000, ["final_expense", "mortgage_protection", "income_protection"]);
assert.deepEqual(big.map((o) => [o.key, o.campaigns.length, o.days]), [["focused", 1, 35], ["balanced", 3, 15], ["spread", 5, 14]]);
for (const o of big) {
  assert.ok(o.days >= 14 && o.perCampaignCents >= 1000, `${o.key} keeps the limits`);
  assert.ok(o.dailyCents * o.days <= 70_000, `${o.key} stays within the batch`);
}
assert.equal(recommendOption(big, ["final_expense", "mortgage_protection"], noHistory).key, "balanced", "no data: one per focus");
const history = { spentCents: 60_000, bookedCalls: 20, batches: 1, byTopic: { final_expense: { spentCents: 20_000, bookedCalls: 12 }, mortgage_protection: { spentCents: 40_000, bookedCalls: 8 } } };
assert.equal(bestTopic(history), "final_expense", "$16.67 vs $50 per call is a clear winner");
assert.equal(recommendOption(batchOptions(56_000, ["mortgage_protection", "final_expense"], "final_expense"), ["mortgage_protection", "final_expense"], history).key, "focused");
assert.equal(batchOptions(56_000, ["mortgage_protection", "final_expense"], "final_expense")[0].campaigns[0], "final_expense", "focused backs the winner, not just the first focus");
assert.deepEqual(outcomeEstimate(56_000, history), { costPerCallCents: 3000, low: 14, high: 22 });
assert.equal(outcomeEstimate(56_000, noHistory), null, "no estimate without the agent's own data");
assert.equal(findOption(28_000, ["final_expense"], "spread"), null, "the server re-derives options; a made-up one is refused");
ok("batches: focused / balanced / spread within 14+ days and $10+/day per campaign; recommendation and estimate from the agent's own results");

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

console.log(`\nALL ${n} UNIT GROUPS PASSED`);
