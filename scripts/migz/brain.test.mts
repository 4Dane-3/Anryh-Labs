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

// topics
const { cleanFocus } = await import("@/lib/migz/topics");
assert.deepEqual(cleanFocus(["final_expense", "bogus", "final_expense", "term_life", "policy_review", "whole_life"]), ["final_expense", "term_life", "policy_review"]);
assert.deepEqual(cleanFocus(null), []);
ok("ad focus: known topics only, no repeats, at most 3, order kept");

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

console.log(`\nALL ${n} UNIT GROUPS PASSED`);
