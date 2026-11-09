import assert from "node:assert/strict";
const R = await import("@/lib/roofing/job-rules");
const { OPEN_RULES, FORM_DEFAULTS, cleanRules, hasRules, evaluateLead, jobTypeOf, roofAgeRange, roofKindOf, withRuleQuestions, neededKeys, callQuestions, describeRules, notFitMessage, factsFromAnswers } = R;
const { ROOFING_QUESTIONS } = await import("@/lib/booking/questions");
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };
const rules = (o: Record<string, unknown>) => cleanRules({ ...OPEN_RULES, ...o })!;

// no rules, or open rules, let everything through (current roofers are unchanged)
assert.equal(evaluateLead(null, { roofIssue: "A leak", ownsHome: "No", property: "Commercial" }).verdict, "fit");
assert.equal(evaluateLead(OPEN_RULES, { ownsHome: "No" }).verdict, "fit");
assert.equal(hasRules(null), false);
assert.equal(hasRules(OPEN_RULES), false);
assert.equal(hasRules(FORM_DEFAULTS), true, "homeowner-only is on in the form defaults");
assert.deepEqual(neededKeys(null), []);
assert.deepEqual(withRuleQuestions(ROOFING_QUESTIONS, null), ROOFING_QUESTIONS);
ok("no rules (or open rules) let everything through and change nothing");

// cleaning: junk dropped, numbers bounded, text zips split
const c = cleanRules({ jobTypes: ["repair", "bogus", "repair"], minJobDollars: "2500", claims: "weird", minRoofAge: -3, roofTypes: ["metal", "plastic"], property: "x", homeownerOnly: true, excluded: "75001, Frisco\n, 75001", notes: " hi " })!;
assert.deepEqual(c.jobTypes, ["repair"]);
assert.equal(c.minJobDollars, 2500); assert.equal(c.claims, "any"); assert.equal(c.minRoofAge, null);
assert.deepEqual(c.roofTypes, ["metal"]); assert.equal(c.property, "both"); assert.equal(c.emergencies, true);
assert.deepEqual(c.excluded, ["75001", "Frisco"]); assert.equal(c.notes, "hi");
assert.equal(cleanRules("nope"), null); assert.equal(cleanRules(null), null);
ok("rules are cleaned: unknown values dropped, numbers bounded, zips and towns split");

// reading answers
assert.equal(jobTypeOf({ roofIssue: "It's old, thinking about replacing" }), "replacement");
assert.equal(jobTypeOf({ roofIssue: "A leak" }), "repair");
assert.equal(jobTypeOf({ roofIssue: "Storm or hail" }), "repair");
assert.equal(jobTypeOf({ roofIssue: "Just want it checked" }), "inspection");
assert.equal(jobTypeOf({ roofIssue: "Gutters" }), "gutters");
assert.equal(jobTypeOf({ roofIssue: "siding is rotting" }), "siding");
assert.equal(jobTypeOf({ roofIssue: "", jobType: "replacement" }), "replacement");
assert.equal(jobTypeOf({ roofIssue: "hmm" }), null);
assert.deepEqual(roofAgeRange("Under 10 years"), [0, 9]);
assert.deepEqual(roofAgeRange("10–20 years"), [10, 20]);
assert.deepEqual(roofAgeRange("Over 20 years"), [20, 100]);
assert.deepEqual(roofAgeRange("about 18 years old"), [18, 18]);
assert.equal(roofAgeRange("Not sure"), null);
assert.equal(roofKindOf("Shingle"), "asphalt"); assert.equal(roofKindOf("standing seam metal"), "metal");
assert.equal(roofKindOf("Flat"), "flat"); assert.equal(roofKindOf("cedar shake"), "cedar"); assert.equal(roofKindOf("Not sure"), null);
ok("issue, roof age and roof type are read from the intake answers and from spoken words");

// each rule: a clear mismatch is not_fit, unknown is unsure (never blocks), a match fits
const base = { roofIssue: "It's old, thinking about replacing", roofAge: "Over 20 years", roofType: "Shingle", ownsHome: "Yes", property: "Residential", insuranceClaim: "Not yet", decisionMakers: "Yes", address: "1420 Oak St, Plano, TX 75023" };
const v = (o: Record<string, unknown>, f = {}) => evaluateLead(rules(o), { ...base, ...f });
assert.equal(v({}).verdict, "fit");
assert.equal(v({ jobTypes: ["repair"] }).verdict, "not_fit");
assert.equal(v({ jobTypes: ["replacement"] }).verdict, "fit");
assert.equal(v({ jobTypes: ["repair"] }, { roofIssue: "hmm" }).verdict, "unsure");
assert.equal(v({ jobTypes: ["inspection"] }, { roofIssue: "Just want it checked" }).verdict, "fit");
assert.equal(v({ minJobDollars: 5000 }, { jobDollars: 800 }).verdict, "not_fit");
assert.equal(v({ minJobDollars: 5000 }).verdict, "fit", "size unknown never blocks");
assert.equal(v({ claims: "never" }, { insuranceClaim: "Yes, it's open" }).verdict, "not_fit");
assert.equal(v({ claims: "never" }).verdict, "fit");
assert.equal(v({ claims: "only" }).verdict, "not_fit");
assert.equal(v({ claims: "only" }, { insuranceClaim: "Yes, it's open" }).verdict, "fit");
assert.equal(v({ claims: "never" }, { insuranceClaim: "" }).verdict, "unsure");
assert.equal(v({ minRoofAge: 15 }, { roofAge: "Under 10 years" }).verdict, "not_fit");
assert.equal(v({ minRoofAge: 15 }, { roofAge: "10–20 years" }).verdict, "unsure");
assert.equal(v({ minRoofAge: 15 }, { roofAge: "Not sure" }).verdict, "unsure");
assert.equal(v({ minRoofAge: 15 }).verdict, "fit");
assert.equal(v({ minRoofAge: 15 }, { roofIssue: "A leak", roofAge: "Under 10 years" }).verdict, "fit", "roof age only screens replacement leads");
assert.equal(v({ roofTypes: ["metal", "tile"] }).verdict, "not_fit");
assert.equal(v({ roofTypes: ["asphalt"] }).verdict, "fit");
assert.equal(v({ roofTypes: ["metal"] }, { roofType: "Not sure" }).verdict, "unsure");
assert.equal(v({ property: "residential" }, { property: "Commercial" }).verdict, "not_fit");
assert.equal(v({ property: "commercial" }).verdict, "not_fit");
assert.equal(v({ property: "residential" }, { property: "" }).verdict, "unsure");
assert.equal(v({ homeownerOnly: true }, { ownsHome: "No" }).verdict, "not_fit");
assert.equal(v({ homeownerOnly: true }, { ownsHome: "" }).verdict, "unsure");
assert.equal(v({ homeownerOnly: false }, { ownsHome: "No" }).verdict, "fit");
assert.equal(v({ allDecisionMakers: true }, { decisionMakers: "No" }).verdict, "unsure", "never a hard block");
assert.equal(v({ allDecisionMakers: true }, { decisionMakers: "No" }).flags.length, 1);
assert.equal(v({ excluded: ["75023"] }).verdict, "not_fit");
assert.equal(v({ excluded: ["Plano"] }).verdict, "not_fit");
assert.equal(v({ excluded: ["plan"] }).verdict, "fit", "whole words only");
assert.equal(v({ excluded: ["Frisco", "75001"] }).verdict, "fit");
ok("each rule: a clear mismatch is not_fit, an unknown answer is unsure and never blocks, a match fits");

// reasons, several at once, and the message
const many = v({ homeownerOnly: true, property: "residential" }, { ownsHome: "No", property: "Commercial" });
assert.equal(many.verdict, "not_fit"); assert.equal(many.reasons.length, 2);
assert.match(notFitMessage("Acme Roofing"), /isn't the right fit/);
assert.doesNotMatch(notFitMessage("Acme Roofing"), /homeowner|commercial|claim/i, "the message never names the rule");
ok("several mismatches are all listed; the homeowner-facing message is polite and names no rule");

// emergencies
const leak = { roofIssue: "A leak", activeLeak: true };
assert.equal(evaluateLead(rules({ emergencies: true }), { ...base, ...leak }).urgent, true);
assert.equal(evaluateLead(rules({ emergencies: false }), { ...base, ...leak }).urgent, false);
assert.equal(evaluateLead(rules({ emergencies: false }), { ...base, ...leak }).emergencyDeclined, true);
assert.equal(evaluateLead(null, { ...base, ...leak }).urgent, true);
assert.equal(evaluateLead(rules({}), { ...base, activeLeak: false }).urgent, false);
ok("an active leak is urgent when the roofer takes same-day calls, and never promised when they don't");

// the booking page's questions follow the rules
const keysOf = (r: Record<string, unknown>) => neededKeys(rules(r));
assert.deepEqual(keysOf({ homeownerOnly: true }), ["homeowner"]);
assert.deepEqual(keysOf({ property: "commercial", roofTypes: ["metal"], minRoofAge: 10 }), ["roof_issue", "property_type", "roof_age", "roof_type"]);
assert.deepEqual(keysOf({ financing: true, notes: "hi", emergencies: false }), [], "financing and notes ask nothing");
const trimmed = ROOFING_QUESTIONS.filter((q) => q.key !== "roof_type").map((q) => (q.key === "roof_age" ? { ...q, enabled: false, required: false } : q));
const wq = withRuleQuestions(trimmed, rules({ property: "residential", roofTypes: ["asphalt"], minRoofAge: 10, allDecisionMakers: true, claims: "never" }));
const req = (k: string) => wq.find((q) => q.key === k);
assert.equal(req("roof_age")!.enabled && req("roof_age")!.required, true, "a disabled question the rules need is switched on");
assert.ok(req("roof_type") && req("property_type") && req("decision_makers"), "missing questions are added");
assert.equal(req("insurance_claim")!.required, true);
assert.equal(new Set(wq.map((q) => q.key)).size, wq.length);
assert.deepEqual(callQuestions(rules({ homeownerOnly: true, claims: "never" })).map((x) => x.key), ["homeowner", "insurance_claim"]);
assert.deepEqual(callQuestions(null), []);
ok("the page and Emma ask only what the rules need: questions are added or switched on, nothing else");

// from stored answers, and the plain-words summary
const f = factsFromAnswers({ homeowner: { value: "No" }, roof_issue: { value: "A leak" }, property_address: { value: "1 Main St 75001" } });
assert.equal(f.ownsHome, "No"); assert.equal(evaluateLead(rules({ homeownerOnly: true }), f).verdict, "not_fit");
const d = describeRules(rules({ jobTypes: ["repair", "gutters"], homeownerOnly: true, financing: true, excluded: ["75001"], emergencies: false, notes: "No flat roofs over 3 stories" }));
assert.ok(d.includes("Takes: repairs, gutters") && d.includes("Homeowners only") && d.includes("Offers financing") && d.includes("No same-day leak emergencies") && d.includes("Won't go to: 75001"));
assert.deepEqual(describeRules(null), []);
ok("rules read back from stored answers; the plain-words summary lists each rule");

// the roofer's new-booking email shows the verdict, the flags and the rules (and nothing extra without rules)
const { inspectionEmail } = await import("@/lib/roofing/notify");
const agent = { full_name: "Acme Roofing", timezone: "America/Chicago" };
const booking = { id: "b1", starts_at: "2026-11-10T16:00:00Z", ends_at: "2026-11-10T17:00:00Z", name: "Pat Homeowner", email: "pat@example.com", phone: "+12145550142" };
const rr = rules({ homeownerOnly: true, financing: true });
const unsureFit = evaluateLead(rr, { ownsHome: "" });
const withFit = inspectionEmail(agent, booking, null, { fit: unsureFit, rules: rr });
assert.match(withFit.text, /Your job rules: Check at inspection: Didn't confirm they own the home/);
assert.match(withFit.text, /Rules set: Homeowners only · Offers financing/);
assert.match(inspectionEmail(agent, booking, null, { fit: evaluateLead(rr, { ownsHome: "Yes" }), rules: rr }).text, /Your job rules: Fits your rules/);
assert.match(inspectionEmail(agent, booking, null, { fit: evaluateLead(null, { roofIssue: "A leak", activeLeak: true }), rules: null }).text, /Active leak: .*Call them first/);
const plain = inspectionEmail(agent, booking, null);
assert.doesNotMatch(plain.text, /job rules|Rules set/i);
assert.doesNotMatch(inspectionEmail(agent, booking, null, { fit: evaluateLead(null, {}), rules: null }).text, /job rules|Rules set/i);
ok("the roofer's booking email shows how the lead fit, what to check and the rules; unchanged for roofers with no rules");

console.log(`\n${n} job-rules checks passed`);
