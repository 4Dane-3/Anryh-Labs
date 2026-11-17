import assert from "node:assert/strict";
const { inboundVariables, classifyInbound, leadStatusFor, inboundSummaryEmail, cleanInboundPrefs, isInboundMode } = await import("@/lib/voice/inbound-rules");
let n = 0; const ok = (m: string) => { n++; console.log("  ✓", m); };

// Preferences: junk in, safe defaults out
assert.deepEqual(cleanInboundPrefs(null), { tone: "casual", transfer_existing: true, transfer_urgent: true, faqs: "", notes: "" });
assert.equal(cleanInboundPrefs({ tone: "formal", transfer_existing: false, faqs: "x".repeat(5000) }).faqs.length, 2000);
assert.equal(cleanInboundPrefs({ tone: "loud" }).tone, "casual");
assert.ok(isInboundMode("mix") && !isInboundMode("all"));
ok("preferences are cleaned and capped");

// Variables: every one present as a string, transfer flags off without a number
const account = { full_name: "Summit Roofing", timezone: "America/Los_Angeles", service_area: "Tacoma, WA", service_radius_miles: 30, inbound_transfer_number: "+12535550100", inbound_prefs: { tone: "formal", transfer_existing: false } };
const v = inboundVariables({ account, leadId: "L", callId: "C", hours: "Monday to Friday 9am–5pm", callerKnown: true });
assert.equal(v.company_name, "Summit Roofing");
assert.equal(v.service_area, "Tacoma, WA, within 30 miles");
assert.equal(v.can_transfer, "yes");
assert.equal(v.transfer_existing, "no");
assert.equal(v.transfer_urgent, "yes");
assert.equal(v.tone, "polished and formal");
assert.ok(Object.values(v).every((x) => typeof x === "string"));
const noTransfer = inboundVariables({ account: { ...account, inbound_transfer_number: null }, leadId: "L", callId: "C", hours: "", callerKnown: false });
assert.equal(noTransfer.can_transfer, "no");
assert.equal(noTransfer.transfer_urgent, "no", "no transfers without a number, whatever the prefs say");
const unknown = inboundVariables({ account: null, leadId: "", callId: "", hours: "", callerKnown: false });
assert.equal(unknown.line_ready, "no");
assert.deepEqual(Object.keys(unknown).sort(), Object.keys(v).sort(), "an unassigned number still gets every variable");
ok("dynamic variables, with transfers only when there's a number");

// Classification: the server's facts beat what the agent collected
const base = { collected: {}, booked: false, doNotCall: false, notAFit: false, callerTurns: 4 };
assert.deepEqual(classifyInbound({ ...base, booked: true, collected: { caller_type: "other", outcome: "message" } }), { callerType: "new_customer", outcome: "booked" });
assert.deepEqual(classifyInbound({ ...base, callerTurns: 0 }), { callerType: "other", outcome: "hung_up" });
assert.deepEqual(classifyInbound({ ...base, collected: { caller_type: "existing_customer" }, terminationReason: "Call transferred to +1253..." }), { callerType: "existing_customer", outcome: "transferred" });
assert.deepEqual(classifyInbound({ ...base, collected: { caller_type: "new_customer", outcome: "booked" } }), { callerType: "new_customer", outcome: "callback" }, "said booked but no booking exists");
assert.deepEqual(classifyInbound({ ...base, notAFit: true, collected: { caller_type: "new_customer" } }), { callerType: "new_customer", outcome: "not_qualified" });
assert.deepEqual(classifyInbound({ ...base, collected: { caller_type: "vendor" } }), { callerType: "vendor", outcome: "message" });
assert.deepEqual(classifyInbound({ ...base, doNotCall: true, collected: { caller_type: "spam" } }), { callerType: "spam", outcome: "do_not_call" });
assert.equal(leadStatusFor("message"), "callback");
assert.equal(leadStatusFor("booked"), "booked");
ok("calls are classified from what really happened");

// Summary email
const e = inboundSummaryEmail({ company: "Summit Roofing", callerType: "existing_customer", outcome: "message", callerName: "Dana <b>", phone: "(253) 555-0199", message: "Gutter came loose after the job.", collected: { callback_time: "after 3pm" }, summary: null, bookedLabel: null, durationSecs: 95, link: null });
assert.equal(e.subject, "Took a message: Dana <b> called Summit Roofing");
assert.ok(e.text.includes("Message: Gutter came loose after the job."));
assert.ok(e.text.includes("Call back: after 3pm"));
assert.ok(e.text.includes("Length: 2 min"));
assert.ok(e.html.includes("Dana &lt;b&gt;") && !e.html.includes("Dana <b>"), "html is escaped");
const b = inboundSummaryEmail({ company: "Summit Roofing", callerType: "new_customer", outcome: "booked", callerName: null, phone: null, message: null, collected: {}, summary: "Leak over the kitchen.", bookedLabel: "Friday, November 20 at 10am", durationSecs: null, link: "https://x/dashboard/clients?id=lead:1" });
assert.equal(b.subject, "Booked: Unknown caller called Summit Roofing");
assert.ok(b.text.includes("Booked an inspection, Friday, November 20 at 10am") && b.text.includes("Phone: Hidden"));
ok("summary email");

console.log(`\n${n} inbound checks passed`);
