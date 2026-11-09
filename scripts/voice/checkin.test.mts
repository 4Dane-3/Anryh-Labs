import assert from "node:assert/strict";
const { checkinTime, checkinRetryAt, coversAiCalls, planCheckin, checkinVariables, checkinOutcome, ratingOf, cleanReferralRows, dollars } = await import("@/lib/voice/checkin-rules");
const { ROOFING_CONSENT_TEXT, ROOFING_QUOTE_CONSENT_TEXT, LEGACY_QUOTE_CONSENT_TEXT } = await import("@/lib/booking/constants");
const { referralInviteEmail, issueAlertEmail, referralIntroEmail } = await import("@/lib/roofing/referral-emails");
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };
const at = (iso: string) => new Date(iso);
const NY = "America/New_York";

// 2 hours later inside 8am–8pm, else the next ~10am
assert.equal(checkinTime(NY, at("2026-11-06T15:00:00Z")).toISOString(), "2026-11-06T17:00:00.000Z"); // 10am → noon
assert.equal(checkinTime(NY, at("2026-11-06T23:30:00Z")).toISOString(), "2026-11-07T15:00:00.000Z"); // 6:30pm → 8:30pm is late → 10am tomorrow
assert.equal(checkinTime(NY, at("2026-11-06T08:00:00Z")).toISOString(), "2026-11-06T15:00:00.000Z"); // 3am → 5am is early → 10am today
assert.equal(checkinTime(NY, at("2026-11-06T22:59:00Z")).toISOString(), "2026-11-07T00:59:00.000Z"); // 5:59pm → 7:59pm, still in
ok("check-in call 2 hours after the job, inside 8am–8pm, else the next morning at 10am");

assert.equal(checkinRetryAt(1, NY, at("2026-11-06T17:00:00Z"))!.toISOString(), "2026-11-07T17:00:00.000Z");
assert.equal(checkinRetryAt(2, NY, at("2026-11-07T17:00:00Z")), null);
ok("a no-answer is retried once the next day, then stops");

assert.equal(coversAiCalls(ROOFING_CONSENT_TEXT), true);
assert.equal(coversAiCalls(ROOFING_QUOTE_CONSENT_TEXT), true);
assert.equal(coversAiCalls(LEGACY_QUOTE_CONSENT_TEXT), false);
assert.equal(coversAiCalls("I agree to be contacted by phone, text, and email about my roof inspection and this appointment. Message and data rates may apply."), false);
const base = { callsOn: true, configured: true, consentText: ROOFING_CONSENT_TEXT, phone: "+12145550142", doNotCall: false, tz: NY, doneAt: at("2026-11-06T15:00:00Z") };
assert.equal(planCheckin(base).kind, "call");
assert.deepEqual(planCheckin({ ...base, consentText: LEGACY_QUOTE_CONSENT_TEXT }), { kind: "email_only", reason: "their consent doesn't cover AI calls" });
assert.equal(planCheckin({ ...base, doNotCall: true }).kind, "email_only");
assert.equal(planCheckin({ ...base, callsOn: false }).kind, "email_only");
assert.equal(planCheckin({ ...base, configured: false }).kind, "email_only");
assert.equal(planCheckin({ ...base, phone: "." }).kind, "email_only");
ok("calls only with AI-call consent, a real number, not on do-not-call, calls on and configured; otherwise email only");

const vars = checkinVariables({ id: "j1", name: "sarah lee", email: null, address: "1 Oak St" }, { full_name: "Acme Roofing", referral_reward_cents: 10000, referral_goal: 5 });
assert.deepEqual(vars, { job_id: "j1", first_name: "Sarah", greeting: "Hi Sarah", customer_name: "sarah lee", customer_email: "", company_name: "Acme Roofing", address: "1 Oak St", reward: "a $100 gift card", referral_goal: "5" });
assert.ok(Object.values(vars).every((v) => typeof v === "string"));
assert.equal(dollars(2550), "$25.50");
ok("the check-in agent gets every variable as a string ($100 gift card, 5 referrals)");

assert.equal(ratingOf("4"), 4); assert.equal(ratingOf(5), 5); assert.equal(ratingOf("five"), 5); assert.equal(ratingOf("4 out of 5"), 4); assert.equal(ratingOf("9"), null); assert.equal(ratingOf(""), null);
const o = { doNotCall: false, voicemail: false, userTurns: 4, issueReported: false, referralSent: false, collected: undefined, rating: null };
assert.equal(checkinOutcome({ ...o, referralSent: true, rating: 5 }), "went_well");
assert.equal(checkinOutcome({ ...o, collected: "went_well" }), "went_well");
assert.equal(checkinOutcome({ ...o, issueReported: true, referralSent: true }), "issue", "a problem wins over a sent referral");
assert.equal(checkinOutcome({ ...o, rating: 2, collected: "went_well" }), "issue", "a 2/5 is never 'went well'");
assert.equal(checkinOutcome({ ...o, userTurns: 0 }), "no_answer");
assert.equal(checkinOutcome({ ...o, voicemail: true }), "no_answer");
assert.equal(checkinOutcome({ ...o, doNotCall: true, issueReported: true }), "do_not_call");
assert.equal(checkinOutcome({ ...o, rating: 3 }), "callback");
ok("outcomes: a problem or a low rating is an issue, never 'went well'; do-not-call wins");

const rows = cleanReferralRows(
  [
    { name: "Ann Smith", phone: "(214) 555-0150", email: "ANN@example.com", address: "2 Elm St" },
    { name: "", phone: "", email: "", address: "" },
    { name: "Bob", phone: "214-555-0151" },
    { name: "Ann again", phone: "2145550150" },
    { name: "No phone", phone: "" },
    { name: "Bad email", phone: "2145550152", email: "nope" },
  ],
  5,
);
assert.deepEqual(rows.rows, [
  { name: "Ann Smith", phone: "+12145550150", email: "ann@example.com", address: "2 Elm St" },
  { name: "Bob", phone: "+12145550151", email: null, address: null },
]);
assert.deepEqual(rows.problems.map((p) => p.index), [3, 4, 5]);
assert.equal(cleanReferralRows([{ name: "A", phone: "2145550153" }, { name: "B", phone: "2145550154" }], 1).rows.length, 1);
ok("referral rows: name and phone required, repeats refused, empty rows dropped, capped at what's left");

const invite = referralInviteEmail({ company: "Acme Roofing", customerName: "Sarah Lee", link: "https://x.test/r/abc", rewardCents: 10000, goal: 5, variant: "after_call" });
assert.match(invite.subject, /\$100 gift card/);
assert.match(invite.text, /Refer 5 friends/);
assert.match(invite.html, /https:\/\/x\.test\/r\/abc/);
const withReview = referralInviteEmail({ company: "Acme Roofing", customerName: "Sarah Lee", link: "https://x.test/r/abc", rewardCents: 10000, goal: 5, reviewUrl: "https://g.page/r/abc/review", variant: "after_call" });
assert.match(withReview.text, /Leave a Google review: https:\/\/g\.page\/r\/abc\/review/);
assert.match(withReview.html, /Leave a Google review/);
assert.ok(withReview.text.indexOf("g.page") < withReview.text.indexOf("Refer friends:"), "review first, then the referral");
assert.ok(!invite.text.includes("Google review"), "no review link set: no review ask");
const quiet = referralInviteEmail({ company: "Acme <Roofing>", customerName: "Sarah", link: "https://x.test/r/abc", rewardCents: 10000, goal: 5, variant: "no_call" });
assert.match(quiet.text, /If anything isn't right/);
assert.ok(!quiet.html.includes("<Roofing>"), "escaped");
assert.match(issueAlertEmail({ customerName: "Sarah", phone: "+12145550142", address: null, rating: 2, details: "Gutter left loose", jobDate: "Nov 6" }).subject, /raised a problem \(2\/5\)/);
assert.match(referralIntroEmail({ company: "Acme", customerName: "Sarah Lee", referralName: "Ann", bookUrl: "https://x.test/acme", mailingAddress: "1 Main St, Plano TX" }).text, /1 Main St, Plano TX[\s\S]*unsubscribe/);
ok("emails: the invite has the link and reward, the no-call one asks how it went, the intro has the postal address and opt-out");

console.log(`\n${n} check-in checks passed`);
