// Hair transplant clinics: the business type, its ad rules, prompt, angles, questions, consent and the invite email.
// Run: NODE_PATH=scripts/migz/stubs npx tsx --tsconfig ./tsconfig.json scripts/migz/clinic.test.mts
import assert from "node:assert/strict";

const v = await import("@/lib/verticals");
const { checkCopyFor } = await import("@/lib/migz/guardrails");
const { systemPromptFor, MIGZ_CLINIC_SYSTEM_PROMPT, MIGZ_ROOFING_SYSTEM_PROMPT } = await import("@/lib/migz/prompt");
const { angleNotesFor, CLINIC_ANGLES, expectedResults, minDailyFor, campaignMoney } = await import("@/lib/campaign-plan");
const { topicKeysFor, CLINIC_TOPIC_KEYS } = await import("@/lib/migz/topics");
const { defaultQuestionsFor, CLINIC_QUESTIONS } = await import("@/lib/booking/questions");
const { consentTextFor, quoteConsentTextFor, CLINIC_CONSENT_TEXT } = await import("@/lib/booking/constants");
const { consultationEmail, crmPayload } = await import("@/lib/roofing/notify");
const { inviteEmail } = await import("@/lib/admin/invites");
const { specialCategoryFor } = await import("@/lib/migz/agent");

const ok = (m: string) => console.log(`  ✓ ${m}`);
const clinic = { vertical: "hair_clinic" };

// The type itself: a local business, not a roofer
assert.ok(v.isVertical("hair_clinic") && v.VERTICALS.includes("hair_clinic"));
assert.equal(v.verticalOf(clinic), "hair_clinic");
assert.equal(v.verticalOf({ vertical: "nonsense" }), "insurance", "unknown types are insurance, as before");
assert.ok(v.isLocal(clinic) && v.isClinic(clinic) && !v.isRoofer(clinic));
assert.ok(v.isLocal({ vertical: "roofing" }) && v.isRoofer({ vertical: "roofing" }) && !v.isLocal({ vertical: "insurance" }));
assert.equal(v.words(clinic).booking, "booked consultation");
assert.equal(v.VERTICAL_LABELS.hair_clinic, "Hair transplant clinic");
ok("hair_clinic is a local business with its own words");

// Meta's health policy, enforced on copy
const bad = [
  "Tired of your thinning hair?",
  "Are you going bald? We can help.",
  "See our before and after results",
  "Guaranteed results that last",
  "Permanent results in one day",
  "Look 10 years younger",
  "0% financing available",
  "Perfect for teens",
];
for (const t of bad) assert.ok(checkCopyFor("hair_clinic", t), `blocked: ${t}`);
const good = ["How a surgeon designs a hairline for each face.", "Book a free consultation. No pressure.", "Rated 4.9 on Google by real patients.", "Many men start thinking about a transplant in their 30s."];
for (const t of good) assert.equal(checkCopyFor("hair_clinic", t), null, `allowed: ${t}`);
assert.match(checkCopyFor("hair_clinic", bad[0])!, /health ad rules/);
assert.equal(checkCopyFor("roofing", "Get a free roof inspection"), null, "roofing rules unchanged");
ok("clinic copy: personal attributes, before-and-after, promised results, financing and under-18 are blocked");

// Migz's prompt for clinics: no roofing left in, the health rules in
assert.equal(systemPromptFor("hair_clinic"), MIGZ_CLINIC_SYSTEM_PROMPT);
assert.equal(systemPromptFor("roofing"), MIGZ_ROOFING_SYSTEM_PROMPT);
assert.ok(!/roof|homeowner|shingle/i.test(MIGZ_CLINIC_SYSTEM_PROMPT), "no roofing words in the clinic prompt");
assert.match(MIGZ_CLINIC_SYSTEM_PROMPT, /hair transplant clinic/);
assert.match(MIGZ_CLINIC_SYSTEM_PROMPT, /18 and over/);
assert.match(MIGZ_CLINIC_SYSTEM_PROMPT, /before-and-after/);
assert.match(MIGZ_CLINIC_SYSTEM_PROMPT, /no special ad category/);
ok("Migz's clinic prompt carries the health rules and no roofing");

// Meta: no special category (not Housing), adults 18+
assert.equal(specialCategoryFor(clinic as never), "NONE");
assert.equal(specialCategoryFor({ vertical: "roofing" } as never), "HOUSING");
assert.equal(specialCategoryFor({ vertical: "insurance" } as never), "FINANCIAL_PRODUCTS_SERVICES");
ok("clinic campaigns have no special ad category");

// Plans, angles and topics
assert.deepEqual(angleNotesFor({ underwriting: [], ageMin: null, ageMax: null } as never, "hair_clinic"), Object.values(CLINIC_ANGLES));
assert.deepEqual(topicKeysFor("hair_clinic"), CLINIC_TOPIC_KEYS);
assert.equal(minDailyFor("hair_clinic"), minDailyFor("roofing"), "the local business minimum");
const exp = expectedResults({ answers: { languages: [] } as never, states: [], intent: "high" as never, dailyCents: 10_000, vertical: "hair_clinic" });
assert.equal(exp.lines.length, 1);
assert.equal(exp.lines[0].unit, "booked consultation");
assert.match(exp.lines[0].follow, /consultations/);
assert.equal(campaignMoney({ dailyCents: 10_000, intent: "high" as never, tier: "standard" as never, vertical: "hair_clinic" }).sets.length, 1, "the booking page only");
ok("plans, angles and topics are the clinic's");

// Booking: 18+ asked, no home address; consent about a consultation
assert.equal(defaultQuestionsFor("hair_clinic"), CLINIC_QUESTIONS);
const required = CLINIC_QUESTIONS.filter((q) => q.required).map((q) => q.key);
assert.deepEqual(required, ["adult"], "only the 18+ check is required");
assert.ok(!CLINIC_QUESTIONS.some((q) => /address|roof|home/i.test(q.label)));
assert.equal(consentTextFor("hair_clinic"), CLINIC_CONSENT_TEXT);
assert.match(CLINIC_CONSENT_TEXT, /my consultation/);
assert.ok(!/roof/i.test(quoteConsentTextFor("hair_clinic")));
assert.match(consentTextFor(true), /roof/, "older callers (true = roofing) still work");
ok("clinic booking asks 18+ only, consent is about a consultation");

// The clinic's new-booking email and CRM payload
const booking = { id: "b1", starts_at: "2026-12-01T18:00:00Z", ends_at: "2026-12-01T18:30:00Z", name: "Sam Lee", email: "sam@example.com", phone: "+12065550100" };
const answers = { interest: { label: "What would you like to talk about?", value: "Hair transplant" } };
const mail = consultationEmail({ full_name: "Lee Hair Clinic", timezone: "America/Los_Angeles" }, booking as never, answers);
assert.match(mail.subject, /^New consultation: Sam Lee/);
assert.ok(!/roof|postcard|homeowner/i.test(mail.html + mail.text));
const crm = crmPayload({ slug: "lee", full_name: "Lee Hair Clinic", timezone: "America/Los_Angeles", vertical: "hair_clinic" }, booking as never, answers) as Record<string, unknown>;
assert.equal(crm.event, "consultation.booked");
assert.equal(crm.interest, "Hair transplant");
assert.ok(!("roof_issue" in crm) && !("print_url" in crm));
ok("clinic booking email and CRM payload say consultation, no roof");

// The invite email
const inv = inviteEmail({ name: "Lee Hair Clinic", email: "owner@lee.com", vertical: "hair_clinic", link: "https://anryhlabs.com/login" });
assert.match(inv.text, /free consultations/);
assert.match(inv.html, /https:\/\/anryhlabs\.com\/login/);
assert.ok(!/roof/i.test(inv.text));
assert.match(inviteEmail({ name: "Summit", email: "a@b.co", vertical: "roofing", link: "x" }).text, /roof inspections/);
ok("invite emails fit the business type");

// Under-18s never book a clinic consultation
const { isUnderage, UNDERAGE_MESSAGE, intakeHeader, stepTitles, reviewerName, DEFAULT_QUESTIONS, ROOFING_QUESTIONS } = await import("@/lib/booking/questions");
assert.ok(isUnderage({ adult: "No" }) && isUnderage({ adult: " no " }));
assert.ok(!isUnderage({ adult: "Yes" }) && !isUnderage({}));
assert.match(UNDERAGE_MESSAGE("Lee Hair Clinic"), /adults 18 and over/);
ok("a clinic booking answered 'No' to 18+ is refused");

// Setup choices: a clinic's own CRMs, offers and credentials, all inside the health ad rules
const { setupOptionsFor } = await import("@/lib/roofing/setup-options");
const co = setupOptionsFor("hair_clinic");
const all = [...co.specials, ...co.certifications.flatMap((g) => g.tiers), ...co.extras, co.certLabel, co.extrasLabel, co.sample.join("")];
assert.ok(!all.some((t) => /roof|shingle|gutter|GAF|Owens|warrant/i.test(t)), "no roofing choices for a clinic");
for (const t of all) assert.equal(checkCopyFor("hair_clinic", t), null, `clinic choice breaks the health rules: ${t}`);
assert.ok(!co.crms.includes("JobNimbus") && co.crms.includes("GoHighLevel") && co.crms.includes("None yet"));
assert.equal(co.license, false);
assert.ok(setupOptionsFor("roofing").crms.includes("JobNimbus") && setupOptionsFor("roofing").specials.some((s) => /roof/.test(s)), "roofers unchanged");
ok("clinic setup offers clinic CRMs, offers and credentials, none breaking the health rules");

// After booking: the clinic's heading, steps and name
assert.match(intakeHeader(CLINIC_QUESTIONS), /clinic prepare for your consultation/);
assert.match(intakeHeader(DEFAULT_QUESTIONS), /better deal/, "insurance unchanged");
assert.match(intakeHeader(ROOFING_QUESTIONS), /inspection/);
assert.ok(!stepTitles(CLINIC_QUESTIONS).includes("Your coverage"));
assert.equal(reviewerName(CLINIC_QUESTIONS, "E2E Hair Clinic"), "E2E Hair Clinic");
assert.equal(reviewerName(DEFAULT_QUESTIONS, "Miguel Cruz"), "Miguel");
ok("the page after booking speaks as the clinic");

// Follow-up emails: the clinic's own words, insurance unchanged
const { defaultSequences } = await import("@/lib/email-sequences");
const { senderLines, sequenceEmail } = await import("@/lib/booking/lead-email");
const seqText = (v: string | null) => JSON.stringify(defaultSequences(null, v));
assert.ok(!/life insurance|coverage|roof/i.test(seqText("hair_clinic")));
assert.match(seqText("hair_clinic"), /consultation/);
assert.match(seqText(null), /life insurance/);
assert.match(seqText("roofing"), /roof/);
const lines = senderLines({ agent: { fullName: "Lee Hair Clinic", title: null, licenseNumber: null, email: "a@b.co", vertical: "hair_clinic" }, prospect: { name: "Sam" }, bookUrl: "u", bookPage: "p", business: { name: "Lee", postalAddress: "1 Main St" }, via: "booking" });
assert.equal(lines.role, "Hair transplant clinic");
assert.match(lines.footer, /booked a consultation with Lee Hair Clinic/);
const sent = sequenceEmail({ agent: { fullName: "Miguel Cruz", title: null, licenseNumber: null, email: "a@b.co" }, prospect: { name: "Sam" }, bookUrl: "u", bookPage: "p", business: { name: "FF", postalAddress: "1 Main St" }, via: "page" }, { subject: "Hi", body: "Hello" });
assert.match(sent.text, /Licensed insurance broker[\s\S]*asked Miguel for a life insurance quote/, "insurance emails unchanged");
ok("follow-up emails and their footers fit the clinic");

console.log("clinic checks passed");
