// Speed-to-lead end to end, against a running dev server and the Supabase project in .env.local. Nobody is
// called: the dev server must run without VOICE_LIVE_CALLS (calls are simulated), and the test numbers are
// fictional 555-01xx numbers. Creates a throwaway roofer (e2e-voice-*), and deletes it and everything it made.
//
// Start the dev server with the ElevenLabs vars set to dummies (see .claude/launch.json "voice-dev"), then:
//   BASE=http://localhost:3107 ELEVENLABS_WEBHOOK_SECRET=wsec_e2e_local_only node scripts/voice/e2e.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
globalThis.WebSocket ??= class {}; // supabase-js wants one on Node 20; realtime is unused
const { createClient } = await import("@supabase/supabase-js");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const BASE = process.env.BASE || "http://localhost:3107";
const SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
assert.ok(SECRET, "ELEVENLABS_WEBHOOK_SECRET (same as the dev server's)");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ok = (m) => console.log(`  ✓ ${m}`);
const tag = Date.now().toString(36);
const slug = `e2e-voice-${tag}`;
const PHONE = `+1214555${String(100 + (Date.now() % 90)).padStart(4, "0")}`; // 555-01xx: fictional
const PHONE2 = `+1214555${String(191 + (Date.now() % 8)).padStart(4, "0")}`;

// A zone where it's daytime now, so the call is instant
const zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Asia/Tokyo", "Australia/Sydney"];
const hourIn = (tz) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
const tz = zones.find((z) => hourIn(z) >= 9 && hourIn(z) <= 18);

const tool = (name, body) => fetch(`${BASE}/api/voice/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-voice-secret": SECRET }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const signed = (payload) => {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  return fetch(`${BASE}/api/voice/post-call`, { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": `t=${t},v0=${createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex")}` }, body: raw }).then(async (r) => ({ status: r.status, body: await r.json() }));
};

let agentId;
try {
  const { data: agent, error } = await db
    .from("agents")
    .insert({ slug, full_name: `E2E Voice Roofing ${tag}`, email: `${slug}@example.com`, active: true, vertical: "roofing", crews: 2, timezone: tz, voice_agent: true, service_area: "Plano, TX", service_radius_miles: 25, min_notice_hours: 1, buffer_minutes: 30, slot_minutes: 60 })
    .select("id")
    .single();
  if (error) throw error;
  agentId = agent.id;
  await db.from("availability_rules").insert([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ agent_id: agentId, weekday, start_time: "08:00", end_time: "18:00" })));
  ok(`throwaway roofer ${slug} (calling in ${tz}, ${hourIn(tz)}:00 there)`);

  // 1. Submit → call request within 1 second
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, name: "Test Lead", phone: PHONE, consent: true, address: "1420 Oak St", city: "Plano", roofIssue: "A leak", timezone: tz }) });
  const quote = await res.json();
  const roundTrip = Date.now() - t0;
  assert.equal(res.status, 200, JSON.stringify(quote));
  assert.equal(quote.voice?.status, "calling");
  assert.equal(quote.voice?.from, "(214) 555-0100");
  ok(`thank-you says "We're calling you now from ${quote.voice.from}" (form round trip ${roundTrip}ms)`);

  await new Promise((r) => setTimeout(r, 1500)); // the after() write
  const { data: lead } = await db.from("quote_requests").select("id, received_at, inserted_at, voice_status, voice_attempts, voice_first_call_at, address, roof_issue").eq("agent_id", agentId).single();
  const { data: call } = await db.from("voice_calls").select("*").eq("lead_id", lead.id).single();
  const toRequest = new Date(call.requested_at) - new Date(lead.received_at);
  const api = new Date(call.api_returned_at) - new Date(call.requested_at);
  assert.ok(toRequest < 1000, `submit → call request ${toRequest}ms`);
  assert.equal(lead.voice_status, "calling");
  assert.equal(call.reason, "instant");
  assert.equal(lead.roof_issue, "A leak");
  ok(`submit → inserted ${new Date(lead.inserted_at) - new Date(lead.received_at)}ms → call request ${toRequest}ms (API ${api}ms, simulated), logged on the lead and the call`);

  // 2. Tools: auth, real open times, a real booking
  const unauth = await fetch(`${BASE}/api/voice/tools/open_times`, { method: "POST", body: JSON.stringify({ lead_id: lead.id }) });
  assert.equal(unauth.status, 401);
  const times = await tool("open_times", { lead_id: lead.id });
  assert.ok(times.body.times?.length >= 2, JSON.stringify(times.body));
  ok(`open_times (401 without the secret): ${times.body.times.map((t) => t.label).join("; ")}`);

  // "Jobs we take": no rules lets everything through (also before migration 20261205000000); with rules the SERVER decides
  const open = await tool("check_fit", { lead_id: lead.id, owns_home: "No", active_leak: false });
  assert.equal(open.body.fits, true, JSON.stringify(open.body));
  assert.deepEqual(open.body.still_to_ask, []);
  ok("check_fit with no rules lets everyone through and asks nothing more");
  const probe = await db.from("agents").select("job_rules").eq("id", agentId).single();
  if (!probe.error) {
    await db.from("agents").update({ job_rules: { homeownerOnly: true, claims: "never", roofTypes: ["asphalt"] } }).eq("id", agentId);
    const ask = await tool("check_fit", { lead_id: lead.id, owns_home: "Yes", insurance_claim: "Not yet" });
    assert.equal(ask.body.fits, true);
    assert.deepEqual(ask.body.still_to_ask.map((a) => a.field), ["roof_type"], JSON.stringify(ask.body));
    const no = await tool("check_fit", { lead_id: lead.id, owns_home: "No" });
    assert.equal(no.body.fits, false, JSON.stringify(no.body));
    assert.match(no.body.message, /isn't the right fit/);
    const refused = await tool("book_inspection", { lead_id: lead.id, start: times.body.times[0].start, owns_home: "No" });
    assert.equal(refused.body.fits, false);
    const { count } = await db.from("bookings").select("id", { count: "exact", head: true }).eq("agent_id", agentId);
    assert.equal(count, 0, "a lead who doesn't fit is never booked");
    const { data: fitRow } = await db.from("quote_requests").select("fit_status, fit_detail").eq("id", lead.id).single();
    assert.equal(fitRow.fit_status, "not_fit");
    assert.match(fitRow.fit_detail.reasons[0], /own the home/);
    // the booking page refuses the same way
    const page = await fetch(`${BASE}/api/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, startsAt: times.body.times[0].start, name: "Test Renter", email: "renter@example.com", phone: PHONE2, consent: true, answers: { property_address: "9 Elm St, Plano", homeowner: "No", roof_issue: "A leak", roof_age: "Not sure", roof_type: "Shingle", insurance_claim: "Not yet" } }) });
    assert.equal(page.status, 422, await page.clone().text());
    assert.equal((await page.json()).notFit, true);
    ok("with rules: asks only what they need, refuses a renter on the call and on the booking page, books no one, saves why");
    // "Not sure" about the roof type never blocks: it books and is flagged (unsure); a metal roof is a clear no
    const bookPage = (extra) => fetch(`${BASE}/api/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, startsAt: times.body.times[2].start, name: "Test Unsure", email: "unsure@example.com", phone: PHONE2, consent: true, answers: { property_address: "9 Elm St, Plano", homeowner: "Yes", roof_issue: "A leak", roof_age: "10–20 years", insurance_claim: "Not yet", ...extra } }) });
    const metal = await bookPage({ roof_type: "Metal" });
    assert.equal(metal.status, 422, "a roof type they don't work on is turned away");
    const unsure = await bookPage({ roof_type: "Not sure" });
    assert.equal(unsure.status, 200, await unsure.clone().text());
    await new Promise((r) => setTimeout(r, 2000)); // the after() write
    const { data: ub } = await db.from("bookings").select("fit_status, fit_detail").eq("agent_id", agentId).eq("phone", PHONE2).single();
    assert.equal(ub.fit_status, "unsure");
    assert.match(ub.fit_detail.flags[0], /Roof type not known/);
    ok("booking page: a metal roof is refused (422), 'not sure' books and is saved as unsure with what to check");
    const good = await tool("check_fit", { lead_id: lead.id, owns_home: "Yes", roof_type: "shingle" });
    assert.equal(good.body.fits, true);
    const unsureCall = await tool("check_fit", { lead_id: lead.id, owns_home: "Yes", roof_type: "Not sure" });
    assert.equal(unsureCall.body.verdict, "unsure");
    assert.equal(unsureCall.body.fits, true, "unsure never blocks");
    const leak = await tool("check_fit", { lead_id: lead.id, owns_home: "Yes", roof_type: "shingle", active_leak: true });
    assert.equal(leak.body.urgent, true);
    ok("check_fit: 'not sure' is unsure and still continues; an active leak is urgent for a roofer who takes same-day calls");
  } else ok("(job_rules column not there yet: the with-rules checks were skipped; run migration 20261205000000)");

  const booked = await tool("book_inspection", { lead_id: lead.id, start: times.body.times[0].start, owns_home: "Yes", roof_age: "10–20 years", insurance_claim: "Not yet", decision_makers: "Yes" });
  assert.equal(booked.body.booked, true, JSON.stringify(booked.body));
  const { data: booking } = await db.from("bookings").select("id, starts_at, phone, consent_text, crew, attribution").eq("id", booked.body.booking_id).single();
  const { data: intake } = await db.from("intake_responses").select("answers").eq("booking_id", booking.id).single();
  assert.equal(booking.phone, PHONE);
  assert.equal(intake.answers.property_address.value, "1420 Oak St, Plano");
  assert.equal(intake.answers.homeowner.value, "Yes");
  assert.match(booking.consent_text, /AI-generated voice/);
  ok(`book_inspection made booking ${booking.id.slice(0, 8)} at ${booked.body.when} (crew ${booking.crew}), with the address and answers`);

  // Same time on the second crew is still open (crews respected), and the booked one can't be double-booked twice on crew 1
  const again = await tool("open_times", { lead_id: lead.id });
  assert.ok(again.body.times.some((t) => t.start === times.body.times[0].start), "2 crews: the time stays open for the second crew");
  ok("with 2 crews the booked time is still offered for the second crew");

  // 3. Signed post-call payload is saved
  const bad = await fetch(`${BASE}/api/voice/post-call`, { method: "POST", headers: { "elevenlabs-signature": "t=1,v0=00" }, body: "{}" });
  assert.equal(bad.status, 401);
  const start = Math.floor(new Date(call.requested_at).getTime() / 1000) + 6;
  const post = await signed({
    type: "post_call_transcription",
    event_timestamp: start + 140,
    data: {
      agent_id: "agent_e2e_dummy",
      conversation_id: call.conversation_id,
      status: "done",
      transcript: [
        { role: "agent", message: "Hi Test, this is the AI assistant for E2E Voice Roofing, calling about the roofing request you just sent us. Just so you know, this call may be recorded.", time_in_call_secs: 0 },
        { role: "user", message: "Yeah, hi. I've got a leak over the kitchen.", time_in_call_secs: 9 },
        { role: "agent", message: "Booked for you. See you then!", time_in_call_secs: 120 },
      ],
      metadata: { start_time_unix_secs: start, call_duration_secs: 134, termination_reason: "end_call tool", phone_call: { call_sid: "CA_e2e", external_number: PHONE } },
      analysis: {
        call_successful: "success",
        transcript_summary: "Homeowner with a kitchen leak, roof 10–20 years, no claim yet. Booked an inspection.",
        data_collection_results: { outcome: { value: "booked" }, owns_home: { value: "Yes" }, roof_issue: { value: "Leak over the kitchen" }, roof_age: { value: "10–20 years" }, insurance_claim: { value: "Not yet" }, decision_makers: { value: "Yes" } },
      },
      conversation_initiation_client_data: { dynamic_variables: { lead_id: lead.id } },
    },
  });
  assert.equal(post.status, 200, JSON.stringify(post.body));
  const { data: saved } = await db.from("voice_calls").select("status, outcome, answered_at, duration_secs, summary, collected, transcript, booking_id").eq("id", call.id).single();
  const { data: leadAfter } = await db.from("quote_requests").select("voice_status, voice_booking_id, outcome").eq("id", lead.id).single();
  assert.equal(saved.outcome, "booked");
  assert.equal(saved.booking_id, booking.id);
  assert.equal(saved.transcript.length, 3);
  assert.equal(saved.collected.roof_age, "10–20 years");
  assert.equal(leadAfter.voice_status, "booked");
  ok(`signed post-call payload saved: outcome ${saved.outcome}, answered ${new Date(saved.answered_at) - new Date(lead.received_at)}ms after submit, ${saved.duration_secs}s, ${saved.transcript.length} turns, collected fields (unsigned → 401)`);

  // 4. No answer → retry in 2 minutes; do-not-call stops everything
  const res2 = await fetch(`${BASE}/api/quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, name: "Second Lead", phone: PHONE2, consent: true, timezone: tz }) });
  assert.equal(res2.status, 200);
  await new Promise((r) => setTimeout(r, 1500));
  const { data: lead2 } = await db.from("quote_requests").select("id").eq("agent_id", agentId).eq("phone", PHONE2).single();
  const { data: call2 } = await db.from("voice_calls").select("conversation_id").eq("lead_id", lead2.id).single();
  const fail = await signed({ type: "call_initiation_failure", data: { agent_id: "agent_e2e_dummy", conversation_id: call2.conversation_id, failure_reason: "no-answer", metadata: { type: "twilio", body: {} } } });
  assert.equal(fail.body.outcome, "no_answer");
  const { data: l2 } = await db.from("quote_requests").select("voice_status, voice_next_call_at").eq("id", lead2.id).single();
  const inMin = (new Date(l2.voice_next_call_at) - Date.now()) / 60_000;
  assert.equal(l2.voice_status, "scheduled");
  assert.ok(inMin > 1 && inMin <= 2.1, `retry in ${inMin} min`);
  ok(`no answer → retry scheduled in ${inMin.toFixed(1)} minutes`);

  const dnc = await tool("do_not_call", { lead_id: lead2.id });
  assert.equal(dnc.body.ok, true);
  const { data: l2b } = await db.from("quote_requests").select("voice_status, voice_next_call_at").eq("id", lead2.id).single();
  assert.equal(l2b.voice_status, "do_not_call");
  assert.equal(l2b.voice_next_call_at, null);
  const res3 = await fetch(`${BASE}/api/quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, name: "Second Lead", phone: PHONE2, consent: true, timezone: tz }) });
  const q3 = await res3.json();
  assert.equal(q3.voice, null, "a do-not-call number is never called again");
  ok("do_not_call: retry cancelled, and the same number submitting again isn't called");

  console.log("\nall speed-to-lead checks passed");
} catch (e) {
  console.error("\nFAILED:", e);
  process.exitCode = 1;
} finally {
  await db.from("voice_do_not_call").delete().in("phone", [PHONE, PHONE2]);
  if (agentId) await db.from("agents").delete().eq("id", agentId); // cascades to leads, calls, bookings, rules
  console.log(`cleaned up ${slug}`);
}
