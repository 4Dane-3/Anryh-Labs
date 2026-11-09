import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
const { inCallWindow, nextCallTime, retryAt, leadTimezone, validElevenLabsSignature, spokenTimes, hoursSummary, dynamicVariables, median, callTimeLabel } = await import("@/lib/voice/rules");
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };
const at = (iso: string) => new Date(iso);
const NY = "America/New_York", LA = "America/Los_Angeles";

// window: 8am–8pm in the lead's zone
assert.equal(inCallWindow(NY, at("2026-11-06T13:00:00Z")), true); // 8:00am NY
assert.equal(inCallWindow(NY, at("2026-11-06T12:59:00Z")), false); // 7:59am
assert.equal(inCallWindow(NY, at("2026-11-07T00:59:00Z")), true); // 7:59pm
assert.equal(inCallWindow(NY, at("2026-11-07T01:00:00Z")), false); // 8:00pm
assert.equal(inCallWindow(LA, at("2026-11-06T13:00:00Z")), false, "8am NY is 5am LA");
ok("calls only 8am–8pm in the lead's time zone");

// after 8pm → 8am next day; before 8am → 8am today
assert.equal(nextCallTime(NY, at("2026-11-07T02:00:00Z")).toISOString(), "2026-11-07T13:00:00.000Z"); // 9pm Fri → 8am Sat
assert.equal(nextCallTime(NY, at("2026-11-06T10:00:00Z")).toISOString(), "2026-11-06T13:00:00.000Z"); // 5am → 8am
const inside = at("2026-11-06T15:00:00Z");
assert.equal(nextCallTime(NY, inside), inside);
assert.equal(callTimeLabel(at("2026-11-07T13:00:00Z"), NY, at("2026-11-07T02:00:00Z")), "8am tomorrow");
assert.equal(callTimeLabel(at("2026-11-06T13:00:00Z"), NY, at("2026-11-06T10:00:00Z")), "8am today");
ok("outside the window the first call is 8am, labelled for the thank-you state");

// retries: +2 min, then next day, then stop
assert.equal(retryAt(1, NY, at("2026-11-06T15:00:00Z"))!.toISOString(), "2026-11-06T15:02:00.000Z");
assert.equal(retryAt(1, NY, at("2026-11-07T00:59:00Z"))!.toISOString(), "2026-11-07T13:00:00.000Z", "a 7:59pm miss retries at 8am, not 8:01pm");
assert.equal(retryAt(2, NY, at("2026-11-06T15:02:00Z"))!.toISOString(), "2026-11-07T15:02:00.000Z");
assert.equal(DateTimeHour(retryAt(2, NY, at("2026-11-07T00:58:00Z"))!, NY), 19, "next-day retry stays inside the window");
assert.equal(retryAt(3, NY, at("2026-11-06T15:00:00Z")), null);
ok("no-answer: retried after 2 minutes, then the next day, then stopped");

assert.equal(leadTimezone("America/Chicago", NY), "America/Chicago");
assert.equal(leadTimezone("Mars/Base", NY), NY);
assert.equal(leadTimezone(undefined, NY), NY);
ok("lead time zone from the browser, else the account's");

// HMAC
const secret = "wsec_test";
const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "c1" } });
const t = Math.floor(Date.now() / 1000);
const sig = `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
assert.equal(validElevenLabsSignature(body, sig, secret), true);
assert.equal(validElevenLabsSignature(body + " ", sig, secret), false, "tampered body");
assert.equal(validElevenLabsSignature(body, sig, "other"), false, "wrong secret");
assert.equal(validElevenLabsSignature(body, sig, secret, (t + 3600) * 1000), false, "replayed an hour later");
assert.equal(validElevenLabsSignature(body, null, secret), false);
ok("ElevenLabs HMAC signature checked, with replay window");

// spoken times
const open = ["2026-11-09T14:00:00.000Z", "2026-11-09T15:00:00.000Z", "2026-11-09T19:00:00.000Z", "2026-11-10T14:00:00.000Z", "2026-11-11T20:00:00.000Z", "2026-11-12T14:00:00.000Z"];
const s = spokenTimes(open, NY);
assert.deepEqual(s.map((x) => x.label), ["Monday, November 9 at 9am", "Monday, November 9 at 2pm", "Tuesday, November 10 at 9am", "Wednesday, November 11 at 3pm"]);
assert.equal(spokenTimes(open, NY, "2026-11-09").length, 3);
assert.equal(spokenTimes(open, NY, "2026-11-13").length, 0);
ok("open times read out: soonest 3 days, a morning and an afternoon each, or one asked-for day");

assert.equal(hoursSummary([1, 2, 3, 4, 5].map((d) => ({ weekday: d, start_time: "09:00:00", end_time: "17:00:00" })).concat([{ weekday: 6, start_time: "09:00", end_time: "12:30" }])), "Monday to Friday 9am–5pm, Saturday 9am–12:30pm");
const v = dynamicVariables({ id: "L1", name: "sarah connor", city: "Plano", roof_issue: "A leak" }, { full_name: "Lone Star Roofing", vertical: "roofing", service_area: "Plano, TX", service_radius_miles: 25, timezone: "America/Chicago" }, "Mon–Fri", "America/Chicago");
assert.equal(v.first_name, "Sarah"); assert.equal(v.greeting, "Hi Sarah"); assert.equal(v.business, "roofing"); assert.equal(v.service_area, "Plano, TX, within 25 miles"); assert.equal(v.address, "");
assert.equal(dynamicVariables({ id: "L2", name: "Instant form lead" }, { full_name: "X", timezone: NY }, "", NY).greeting, "Hi there");
assert.ok(Object.values(v).every((x) => typeof x === "string"), "every variable is a string, none missing");
ok("dynamic variables: name, company, city, roof issue, hours; always present");

assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); assert.equal(median([]), null);
ok("median");

function DateTimeHour(d: Date, tz: string) { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(d)); }
console.log(`\n${n} voice checks passed`);
