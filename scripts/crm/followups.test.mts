// Pure checks for the CRM follow-up emails: the schedule (9:00 local, weekdays), who's blocked, and the email.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { blockedReason, DEFAULT_OFFER, DEFAULT_PROCESS, firstMorning, followUpEmail, nextSendAt, processSteps } from "../../src/lib/crm/followups.ts";

const LA = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);
const local = (d: Date) => d.toLocaleString("en-US", { timeZone: LA, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Mon Nov 9 2026, 2:15pm LA
const mon = at("2026-11-09T22:15:00Z");
assert.equal(local(nextSendAt(mon, "daily", LA)), "Tue, Nov 10, 9:00 AM");
assert.equal(local(nextSendAt(mon, "every_2_days", LA)), "Wed, Nov 11, 9:00 AM");
assert.equal(local(nextSendAt(mon, "twice_monthly", LA)), "Tue, Nov 24, 9:00 AM");
// Fri -> daily lands Sat -> Monday
const fri = at("2026-11-13T17:00:00Z");
assert.equal(local(nextSendAt(fri, "daily", LA)), "Mon, Nov 16, 9:00 AM");
assert.equal(local(nextSendAt(fri, "every_2_days", LA)), "Mon, Nov 16, 9:00 AM");
// First morning: before 9 -> today 9:00; after -> next weekday
assert.equal(local(firstMorning(at("2026-11-10T15:00:00Z"), LA)), "Tue, Nov 10, 9:00 AM"); // 7am LA
assert.equal(local(firstMorning(mon, LA)), "Tue, Nov 10, 9:00 AM");
assert.equal(local(firstMorning(fri, LA)), "Mon, Nov 16, 9:00 AM"); // Fri 9am exactly has passed
// DST change (Nov 1 2026): still 9:00 local
assert.equal(local(nextSendAt(at("2026-10-30T20:00:00Z"), "daily", LA)), "Mon, Nov 2, 9:00 AM");

// Who's blocked
assert.equal(blockedReason({ email: null, status: "lead" }), "No email address");
assert.equal(blockedReason({ email: "a@b.co", status: "lead", unsubscribed_at: "2026-11-01" }), "They unsubscribed");
assert.equal(blockedReason({ email: "a@b.co", status: "client" }), "They're a client now");
assert.equal(blockedReason({ email: "a@b.co", status: "contacted" }, true), "They have a meeting coming up");
assert.equal(blockedReason({ email: "a@b.co", status: "meeting" }), null, "a meeting that's passed doesn't block");
assert.equal(blockedReason({ email: "a@b.co", status: "lost" }, false, "every_2_days"), "Marked lost (only the Monthly retainer can run)");
assert.equal(blockedReason({ email: "a@b.co", status: "lost" }, false, "monthly"), null, "lost prospects can get the retainer");
assert.equal(blockedReason({ email: "a@b.co", status: "lost", unsubscribed_at: "x" }, false, "monthly"), "They unsubscribed");
assert.equal(blockedReason({ email: "a@b.co", status: "contacted" }), null);

// Process lines
assert.deepEqual(processSteps("1. Launch: ads\n- Call: fast\n\nPlain step"), [{ title: "Launch", body: "ads" }, { title: "Call", body: "fast" }, { title: "Plain step", body: "" }]);

// The email: openers rotate, the last asks to keep in touch, offer/process/unsubscribe/address are in every one
const copy = { offer: DEFAULT_OFFER, process: DEFAULT_PROCESS, ctaUrl: "https://cal.com/anryh/intro", ctaLabel: "Book a quick call", postalAddress: "123 Main St, Seattle, WA 98101" };
const mk = (step: number, total = 6) => followUpEmail({ step, total, from: "Dane at Anryh Labs", client: { name: "Alex Rivera", company: "Rivera Roofing" }, copy, unsubscribeUrl: "https://x.test/unsubscribe/abc" });
const subjects = [1, 2, 3, 4, 5, 6].map((s) => mk(s).subject);
assert.equal(new Set(subjects).size, 5, "steps 1-4 differ from each other, 5 repeats 1, 6 is the last note");
assert.equal(subjects[0], "Quick recap for Rivera Roofing: booked roof inspections");
assert.equal(subjects[5], "Should I keep in touch?");
for (const s of [1, 6]) {
  const e = mk(s);
  for (const needle of ["Hi Alex", "8 booked inspections", "Qualify and book", "https://cal.com/anryh/intro", "Unsubscribe", "123 Main St"]) {
    assert.ok(e.html.includes(needle) && e.text.includes(needle.replace("Unsubscribe", "Unsubscribe:")) , `#${s} has ${needle}`);
  }
}
// A company-only client gets "Hi there"; no button without a link
const co = followUpEmail({ step: 1, total: 3, from: "Anryh Labs", client: { name: null, company: null }, copy: { ...copy, ctaUrl: null }, unsubscribeUrl: "u" });
assert.ok(co.html.includes("Hi there") && !co.html.includes("Book a quick call") && co.subject.includes("your team"));
// HTML escapes what staff type
const x = followUpEmail({ step: 1, total: 1, from: "A<b>", client: { name: "<script>", company: "X" }, copy: { ...copy, offer: "<img src=x onerror=alert(1)>" }, unsubscribeUrl: "u" });
assert.ok(!x.html.includes("<script>") && !x.html.includes("<img src=x"));

// Monthly retainer: a calendar month later at 9:00 (weekend -> Monday), rotating notes, never the "last" one
assert.equal(local(nextSendAt(mon, "monthly", LA)), "Wed, Dec 9, 9:00 AM");
assert.equal(local(nextSendAt(at("2026-12-07T17:00:00Z"), "monthly", LA)), "Thu, Jan 7, 9:00 AM");
assert.equal(local(nextSendAt(at("2026-10-10T17:00:00Z"), "monthly", LA)), "Tue, Nov 10, 9:00 AM"); // Nov 10 2026 is a Tuesday
assert.equal(local(nextSendAt(at("2026-11-14T17:00:00Z"), "monthly", LA)), "Mon, Dec 14, 9:00 AM"); // Dec 14 is a Monday
const mo = (step: number) => followUpEmail({ step, total: 6, cadence: "monthly", from: "Dane at Anryh Labs", client: { name: "Alex Rivera", company: "Rivera Roofing" }, copy, unsubscribeUrl: "https://x.test/u" });
const moSubjects = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => mo(s).subject);
assert.equal(new Set(moSubjects).size, 4, "four monthly notes that repeat");
assert.ok(!moSubjects.includes("Should I keep in touch?"));
assert.ok(mo(6).html.includes("once a month") && mo(1).html.includes("8 booked inspections") && mo(1).html.includes("Unsubscribe"));
assert.ok(mo(1).text.includes("Whenever the timing's right"));

writeFileSync(process.env.OUT ?? "/dev/null", mk(1).html);
console.log("followups: all checks passed");
