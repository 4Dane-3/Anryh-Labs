// Run: NODE_PATH=scripts/migz/stubs TSX_TSCONFIG_PATH=./tsconfig.json node --import tsx scripts/migz/google-ads.test.mts
import assert from "node:assert/strict";
import { cityOf, customerIdFrom, formatCustomerId, proximityAddress } from "../../src/lib/google-ads/ids.ts";
import { adGroupPlans, BASE_NEGATIVES, callouts, dailyFromMonthly, negativesFor } from "../../src/lib/google-ads/playbook.ts";
import { blocks, checkAction, checkAdText, cleanKeyword, needsApproval, type GuardCtx } from "../../src/lib/google-ads/guardrails.ts";
import { parseAction } from "../../src/lib/google-ads/tools.ts";
import { operationsFor } from "../../src/lib/google-ads/executor.ts";
import { conversionFor, fromGoogle, googleTime } from "../../src/lib/google-ads/conversions.ts";
import { OPEN_RULES, type JobRules } from "../../src/lib/roofing/job-rules.ts";
import type { GoogleSnapshot } from "../../src/lib/google-ads/types.ts";

// ---------- Customer ids and places ----------
assert.equal(customerIdFrom("123-456-7890"), "1234567890");
assert.equal(customerIdFrom(" 1234567890 "), "1234567890");
assert.equal(customerIdFrom("https://ads.google.com/aw/overview?ocid=1&__c=9876543210&authuser=0"), "9876543210");
assert.equal(customerIdFrom("12345"), null);
assert.equal(formatCustomerId("1234567890"), "123-456-7890");
assert.deepEqual(proximityAddress("98052"), { countryCode: "US", postalCode: "98052" });
assert.deepEqual(proximityAddress("1520 K Ave, Plano, TX 75074"), { countryCode: "US", provinceCode: "TX", streetAddress: "1520 K Ave", cityName: "Plano", postalCode: "75074" });
assert.deepEqual(proximityAddress("Kent", "WA"), { countryCode: "US", provinceCode: "WA", cityName: "Kent" });
assert.equal(proximityAddress(""), null);
assert.equal(cityOf("Bellevue, WA"), "Bellevue");
assert.equal(cityOf("98052"), null);

// ---------- Playbook ----------
assert.equal(dailyFromMonthly(150_000), 4934); // $1,500/month → $49.34/day
const rules: JobRules = { ...OPEN_RULES, jobTypes: ["replacement", "repair"], claims: "never", property: "residential", roofTypes: ["asphalt", "metal"] };
const groups = adGroupPlans({ company: "Summit Roofing Co", city: "Kent", rules, offer: "inspection", special: "$500 off a full roof replacement", warranty: "GAF Golden Pledge warranty", certification: "GAF Master Elite" });
assert.deepEqual(groups.map((g) => g.key), ["replacement", "repair"]); // no storm group without claims, no gutters/siding
for (const g of groups) {
  assert.equal(checkAdText(g.headlines, g.descriptions, g.path1, g.path2), null, `${g.name}: ${checkAdText(g.headlines, g.descriptions, g.path1, g.path2)}`);
  assert.ok(g.headlines.length >= 10, `${g.name} has ${g.headlines.length} headlines`);
  assert.ok(g.keywords.some((k) => k.text.includes("kent")), "city keywords");
  for (const k of g.keywords) assert.ok(cleanKeyword(k.text), k.text);
}
const withClaims = adGroupPlans({ company: "A", city: null, rules: { ...OPEN_RULES }, offer: "quote", special: null, warranty: null, certification: null });
assert.ok(withClaims.some((g) => g.key === "storm"));
assert.ok(withClaims.every((g) => checkAdText(g.headlines, g.descriptions, g.path1, g.path2) === null));
const negs = negativesFor(rules);
for (const n of ["gutter", "siding", "insurance claim", "commercial", "tile roof", "flat roof"]) assert.ok(negs.includes(n), n);
assert.ok(!negs.includes("metal roof"));
assert.ok(BASE_NEGATIVES.includes("jobs") && BASE_NEGATIVES.every((n) => cleanKeyword(n)));
assert.ok(callouts({ offer: "inspection", warranty: "x", certification: "GAF Master Elite", emergencies: true }).every((c) => c.length <= 25));

// ---------- Guardrails ----------
assert.ok(blocks({ text: "jobs", match: "PHRASE" }, "roofing jobs near me"));
assert.ok(!blocks({ text: "job", match: "PHRASE" }, "roofing jobs near me"));
assert.ok(blocks({ text: "roof repair cost", match: "EXACT" }, "Roof Repair Cost"));
assert.ok(!blocks({ text: "roof repair cost", match: "EXACT" }, "roof repair cost kent"));

const DAY = 86_400_000;
const now = Date.parse("2026-11-12T12:00:00Z");
const m = (cost: number, clicks: number, conv: number, impr = clicks * 20) => ({ costCents: cost, clicks, conversions: conv, impressions: impr });
const snapshot: GoogleSnapshot = {
  takenAt: new Date(now).toISOString(),
  account: { id: "1234567890", name: "Summit", currency: "USD", timeZone: "America/Los_Angeles", status: "ENABLED" },
  monthSpendCents: 60_000,
  campaigns: [{ id: "55", name: "Migz", status: "ENABLED", bidding: "MAXIMIZE_CONVERSIONS", targetCpaCents: null, budgetResource: "customers/1234567890/campaignBudgets/9", dailyBudgetCents: 4000, impressionShare: 0.4, lostToBudget: 0.3, lostToRank: 0.3, ...m(120_000, 300, 20) }],
  adGroups: [{ id: "100", name: "Roof replacement", status: "ENABLED", campaignId: "55" }],
  keywords: [
    { adGroupId: "100", criterionId: "1", text: "roof replacement", match: "PHRASE", status: "ENABLED", qualityScore: 7, ...m(60_000, 150, 15) },
    { adGroupId: "100", criterionId: "2", text: "new roof cost", match: "PHRASE", status: "ENABLED", qualityScore: 4, ...m(30_000, 40, 0) },
    { adGroupId: "100", criterionId: "3", text: "reroof", match: "PHRASE", status: "ENABLED", qualityScore: 5, ...m(5_000, 8, 0) },
  ],
  searchTerms: [
    { term: "roof replacement kent", status: "NONE", adGroupId: "100", campaignId: "55", ...m(20_000, 30, 4) },
    { term: "roofing jobs near me", status: "NONE", adGroupId: "100", campaignId: "55", ...m(4_000, 6, 0) },
  ],
  ads: [
    { adGroupId: "100", adId: "700", status: "ENABLED", strength: "GOOD", approval: "APPROVED", headlines: [], descriptions: [], ...m(80_000, 200, 15, 4000) },
    { adGroupId: "100", adId: "701", status: "ENABLED", strength: "AVERAGE", approval: "APPROVED", headlines: [], descriptions: [], ...m(40_000, 100, 2, 2000) },
  ],
  negatives: [{ text: "diy", match: "PHRASE" }],
  totals30: m(120_000, 300, 20),
  totals7: m(30_000, 70, 5),
};
const ctx: GuardCtx = { snapshot, campaignId: "55", monthlyCapCents: 150_000, launchedAt: new Date(now - 40 * DAY).toISOString(), lastBudgetChangeAt: null, lastBiddingChangeAt: null, now };

// Negatives: block job seekers; never a converting search, a core word, or your own keyword
assert.equal(checkAction({ tool: "add_negative_keywords", terms: [{ text: "jobs", match: "PHRASE" }] }, ctx), null);
assert.match(checkAction({ tool: "add_negative_keywords", terms: [{ text: "kent", match: "PHRASE" }] }, ctx)!, /booked/);
assert.match(checkAction({ tool: "add_negative_keywords", terms: [{ text: "roofing", match: "PHRASE" }] }, ctx)!, /business/);
assert.match(checkAction({ tool: "add_negative_keywords", terms: [{ text: "cost", match: "PHRASE" }] }, ctx)!, /your own keyword/);
assert.match(checkAction({ tool: "add_negative_keywords", terms: [{ text: "jobs", match: "BROAD" }] }, ctx)!, /PHRASE or EXACT/);

// Keywords: add a converting search; no duplicates, no broad, nothing a negative blocks
assert.equal(checkAction({ tool: "add_keywords", ad_group_id: "100", keywords: [{ text: "roof replacement kent", match: "EXACT" }] }, ctx), null);
assert.match(checkAction({ tool: "add_keywords", ad_group_id: "100", keywords: [{ text: "roof replacement", match: "PHRASE" }] }, ctx)!, /already/);
assert.match(checkAction({ tool: "add_keywords", ad_group_id: "100", keywords: [{ text: "diy roof replacement", match: "PHRASE" }] }, ctx)!, /negative/);
assert.match(checkAction({ tool: "add_keywords", ad_group_id: "999", keywords: [{ text: "x", match: "PHRASE" }] }, ctx)!, /ad group/);

// Pausing: the target is the 30-day $60 per conversion, so $120+ with no conversion and 15+ clicks
assert.equal(checkAction({ tool: "pause_keyword", ad_group_id: "100", criterion_id: "2" }, ctx), null);
assert.match(checkAction({ tool: "pause_keyword", ad_group_id: "100", criterion_id: "3" }, ctx)!, /spent/);
assert.match(checkAction({ tool: "pause_keyword", ad_group_id: "100", criterion_id: "1" }, ctx)!, /keep it/);
assert.equal(checkAction({ tool: "pause_ad", ad_group_id: "100", ad_id: "701" }, ctx), null);

// Budget: capped at $1,500/30.4 = $49.34/day, 25% steps, 3 days apart
assert.equal(checkAction({ tool: "set_daily_budget", daily_cents: 4900 }, ctx), null);
assert.match(checkAction({ tool: "set_daily_budget", daily_cents: 6000 }, ctx)!, /cap/);
assert.match(checkAction({ tool: "set_daily_budget", daily_cents: 2000 }, ctx)!, /25%/);
assert.match(checkAction({ tool: "set_daily_budget", daily_cents: 4500 }, { ...ctx, lastBudgetChangeAt: new Date(now - DAY).toISOString() })!, /wait/);
assert.equal(checkAction({ tool: "set_daily_budget", daily_cents: 4934 }, { ...ctx, snapshot: { ...snapshot, campaigns: [{ ...snapshot.campaigns[0], dailyBudgetCents: 9000 }] } }), null); // back under the cap

// Bidding: target CPA needs 15+ conversions and a target no lower than 80% of actual ($48)
assert.equal(checkAction({ tool: "set_bidding", strategy: "TARGET_CPA", target_cpa_cents: 5500 }, ctx), null);
assert.match(checkAction({ tool: "set_bidding", strategy: "TARGET_CPA", target_cpa_cents: 3000 }, ctx)!, /choke/);
assert.match(checkAction({ tool: "set_bidding", strategy: "TARGET_CPA", target_cpa_cents: 5500 }, { ...ctx, launchedAt: new Date(now - 3 * DAY).toISOString() })!, /first 7 days/);
assert.match(checkAction({ tool: "set_bidding", strategy: "TARGET_CPA", target_cpa_cents: 5500 }, { ...ctx, snapshot: { ...snapshot, totals30: m(50_000, 100, 6) } })!, /15\+/);

// Ad text
assert.match(checkAdText(["Roof Replacement!", "b", "c", "d", "e"], ["x", "y"])!, /"!"/);
assert.match(checkAdText(["A", "B", "C", "D", "Free Roof Today"], ["x", "y"])!, /free roof/i);
assert.match(checkAdText(["A", "B", "C", "D", "BEST ROOFERS"], ["x", "y"])!, /all caps/);
assert.match(checkAdText(["A", "B", "C", "D", "E"], ["We cover your deductible.", "y"])!, /deductible/);

// Ask-first: savings go ahead, spend and ad changes wait
assert.equal(needsApproval({ tool: "add_negative_keywords", terms: [] }, ctx), false);
assert.equal(needsApproval({ tool: "set_daily_budget", daily_cents: 3500 }, ctx), false);
assert.equal(needsApproval({ tool: "set_daily_budget", daily_cents: 4900 }, ctx), true);
assert.equal(needsApproval({ tool: "write_ad", ad_group_id: "100", headlines: [], descriptions: [], path1: "", path2: "" }, ctx), true);

// ---------- Tool parsing and operations ----------
const parsed = parseAction("add_negative_keywords", { terms: [{ text: " Roofing Jobs ", match: "PHRASE" }], title: "Blocked job seekers", reason: "$40, no bookings" });
assert.ok(!("error" in parsed) && parsed.action.tool === "add_negative_keywords");
assert.ok("error" in parseAction("pause_keyword", { ad_group_id: "100" }));
const target = { customerId: "1234567890", campaignId: "55", budgetResource: "customers/1234567890/campaignBudgets/9", landingUrl: "https://anryh.com/summit" };
assert.deepEqual(operationsFor({ tool: "add_negative_keywords", terms: [{ text: "Roofing Jobs", match: "PHRASE" }] }, target), [
  { campaignCriterionOperation: { create: { campaign: "customers/1234567890/campaigns/55", negative: true, keyword: { text: "roofing jobs", matchType: "PHRASE" } } } },
]);
assert.deepEqual(operationsFor({ tool: "pause_keyword", ad_group_id: "100", criterion_id: "2" }, target), [
  { adGroupCriterionOperation: { update: { resourceName: "customers/1234567890/adGroupCriteria/100~2", status: "PAUSED" }, updateMask: "status" } },
]);
assert.deepEqual(operationsFor({ tool: "set_daily_budget", daily_cents: 4900 }, target), [
  { campaignBudgetOperation: { update: { resourceName: "customers/1234567890/campaignBudgets/9", amountMicros: "49000000" }, updateMask: "amountMicros" } },
]);
assert.equal((operationsFor({ tool: "set_bidding", strategy: "TARGET_CPA", target_cpa_cents: 5500 }, target)[0] as { campaignOperation: { update: { maximizeConversions: { targetCpaMicros: string } } } }).campaignOperation.update.maximizeConversions.targetCpaMicros, "55000000");

// ---------- Conversions ----------
assert.equal(googleTime("2026-11-12T14:03:09.123Z"), "2026-11-12 14:03:09+00:00");
assert.ok(fromGoogle({ gclid: "abc" }) && fromGoogle({ utm_source: "google" }) && !fromGoogle({ fbclid: "x" }));
const conv = conversionFor({ id: "b1", email: " Jo@Example.com ", phone: "(425) 555-0100", created_at: "2026-11-12T14:03:00Z", job_done_at: null, attribution: { gclid: "G123" } }, "customers/1/conversionActions/77", "2026-11-12T14:03:00Z", 12000);
assert.equal(conv.gclid, "G123");
assert.equal(conv.conversionValue, 12000);
assert.equal(conv.orderId, "b1:77");
assert.match((conv.userIdentifiers as { hashedEmail: string }[])[0].hashedEmail, /^[0-9a-f]{64}$/);

console.log("google-ads tests passed");
