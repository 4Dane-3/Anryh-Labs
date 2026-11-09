// Post-job check-in and referrals end to end, against a running dev server and the Supabase project in .env.local.
// Nobody is called or emailed: the dev server runs without VOICE_LIVE_CALLS (calls are simulated) and without
// RESEND_API_KEY (emails are logged), and every number is a fictional 555-01xx. Creates a throwaway roofer
// (e2e-checkin-*) and deletes it and everything it made. Needs 20261203000000_job_checkin_referrals.sql.
//
// Start the dev server with dummies (ELEVENLABS_CHECKIN_AGENT_ID too, and CRON_SECRET), then:
//   BASE=http://localhost:3107 ELEVENLABS_WEBHOOK_SECRET=wsec_e2e_local_only CRON_SECRET=cron_e2e_local_only node scripts/voice/checkin-e2e.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
globalThis.WebSocket ??= class {};
const { createClient } = await import("@supabase/supabase-js");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const BASE = process.env.BASE || "http://localhost:3107";
const SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
const CRON = process.env.CRON_SECRET;
assert.ok(SECRET && CRON, "ELEVENLABS_WEBHOOK_SECRET and CRON_SECRET (same as the dev server's)");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ok = (m) => console.log(`  ✓ ${m}`);
const tag = Date.now().toString(36);
const slug = `e2e-checkin-${tag}`;
const base4 = 100 + (Date.now() % 50);
const num = (i) => `+1214555${String(base4 + i).padStart(4, "0")}`; // 555-01xx: fictional
const AI = "I agree to be contacted by phone, text, and email about my roof inspection and this appointment, including calls and texts made using automated technology or an artificial or AI-generated voice, at the number I provided. Calls may be recorded. Message and data rates may apply. Consent is not a condition of purchase.";
const LEGACY = "I agree to be contacted by phone, text, and email about my roof inspection and this appointment. Message and data rates may apply. Consent is not a condition of purchase.";

const zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Asia/Tokyo", "Australia/Sydney"];
const hourIn = (tz) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
const tz = zones.find((z) => hourIn(z) >= 9 && hourIn(z) <= 17);

const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const tool = (name, body) => post(`/api/voice/tools/${name}`, body, { "x-voice-secret": SECRET });
const cron = () => fetch(`${BASE}/api/cron/voice-calls`, { headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const signed = (payload) => {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  return fetch(`${BASE}/api/voice/post-call`, { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": `t=${t},v0=${createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex")}` }, body: raw }).then(async (r) => ({ status: r.status, body: await r.json() }));
};
const job = (id) => db.from("bookings").select("*").eq("id", id).single().then((r) => r.data);
const callFor = (id) => db.from("voice_calls").select("*").eq("job_booking_id", id).order("attempt", { ascending: false }).limit(1).single().then((r) => r.data);
const due = (id) => db.from("bookings").update({ checkin_next_call_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

let agentId;
try {
  const { data: agent, error } = await db
    .from("agents")
    .insert({ slug, full_name: `E2E Checkin Roofing ${tag}`, email: `${slug}@example.com`, active: true, vertical: "roofing", timezone: tz, checkin_calls: true, google_review_url: "https://g.page/r/e2e-test/review", service_area: "Plano, TX", service_radius_miles: 25, slot_minutes: 60 })
    .select("id, job_webhook_token, referral_goal, referral_reward_cents")
    .single();
  if (error) throw error;
  agentId = agent.id;
  const day = Date.now() - 26 * 3600_000;
  const mk = async (i, consent, name) => {
    const starts = new Date(day + i * 2 * 3600_000);
    const { data, error: e } = await db.from("bookings").insert({ agent_id: agentId, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3600_000).toISOString(), name, email: `${slug}-${i}@example.com`, phone: num(i), consent_text: consent }).select("id").single();
    if (e) throw e;
    await db.from("intake_responses").insert({ booking_id: data.id, answers: { property_address: { label: "Address", value: `${i} Oak St, Plano` } }, submitted_at: starts.toISOString() });
    return data.id;
  };
  const happy = await mk(0, AI, "Sarah Happy");
  const legacy = await mk(1, LEGACY, "Larry Legacy");
  const unhappy = await mk(2, AI, "Una Unhappy");
  const missed = await mk(3, AI, "Max Missed");
  ok(`throwaway roofer ${slug} (${tz}, ${hourIn(tz)}:00 there), 4 past inspections, goal ${agent.referral_goal} for $${agent.referral_reward_cents / 100}`);

  // 1. Job completed webhook: auth, match by phone → check-in scheduled ~2 hours out (or 10am)
  assert.equal((await post("/api/jobs/completed", { phone: num(0) }, { "x-job-secret": "00000000-0000-0000-0000-000000000000" })).status, 401);
  const done = await post("/api/jobs/completed", { phone: num(0) }, { "x-job-secret": agent.job_webhook_token });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.booking_id, happy);
  assert.equal(done.body.checkin, "scheduled");
  const inMin = (new Date(done.body.call_at) - Date.now()) / 60_000;
  assert.ok((inMin > 115 && inMin < 125) || new Date(done.body.call_at).getUTCMinutes() === 0, `call_at ${done.body.call_at}`);
  const again = await post("/api/jobs/completed", { booking_id: happy }, { "x-job-secret": agent.job_webhook_token });
  assert.equal(again.body.already, true);
  let h = await job(happy);
  assert.ok(h.referral_token && h.job_done_at);
  ok(`job completed webhook (401 with a wrong secret) matched by phone → check-in call in ${Math.round(inMin)} min; marking it twice is a no-op`);

  // 2. No AI consent → email only, no call
  const leg = await post("/api/jobs/completed", { booking_id: legacy }, { "x-job-secret": agent.job_webhook_token });
  assert.equal(leg.body.checkin, "email_only");
  assert.match(leg.body.reason, /consent/);
  const l = await job(legacy);
  assert.ok(l.referral_email_sent_at, "the referral email went instead");
  assert.equal(l.checkin_next_call_at, null);
  ok(`booking made before the AI wording → no call ("${leg.body.reason}"), referral email instead`);

  // 3. Due → the cron places it with the check-in agent
  await due(happy);
  const c1 = await cron();
  assert.ok(c1.checkins >= 1, JSON.stringify(c1));
  const call = await callFor(happy);
  assert.equal(call.kind, "checkin");
  assert.equal(call.reason, "checkin");
  assert.equal(call.status, "dialing");
  assert.equal(call.lead_id, null);
  assert.match(call.conversation_id, /^sim_/);
  assert.equal((await job(happy)).checkin_status, "calling");
  ok(`cron placed the check-in call (simulated ${call.conversation_id.slice(0, 20)}…), saved as kind checkin`);

  // 4. Went well: send_referral mid-call, then the signed post-call payload
  const sent = await tool("send_referral", { job_id: happy, email: "sarah.new@example.com", rating: "5" });
  assert.equal(sent.body.sent, true, JSON.stringify(sent.body));
  assert.match(sent.body.message, /refer 5 friends.*\$100 gift card/);
  assert.match(sent.body.message, /Google review/i, "the tool tells Emma about the review link");
  h = await job(happy);
  assert.equal(h.email, "sarah.new@example.com");
  assert.ok(h.referral_email_sent_at);
  const pc = await signed({
    type: "post_call_transcription",
    event_timestamp: Math.floor(Date.now() / 1000),
    data: {
      conversation_id: call.conversation_id,
      transcript: [
        { role: "agent", message: "Hi Sarah, this is Emma, the virtual assistant for E2E Checkin Roofing. This call may be recorded. Just checking in to see if everything went well.", time_in_call_secs: 0 },
        { role: "user", message: "Yes, it went great, the crew was quick.", time_in_call_secs: 6 },
        { role: "agent", message: "Wonderful! On a scale of 1 to 5?", time_in_call_secs: 9 },
        { role: "user", message: "Five.", time_in_call_secs: 12 },
      ],
      metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000) - 90, call_duration_secs: 85 },
      analysis: { transcript_summary: "Customer happy with the roof job, rated 5/5, referral email sent.", data_collection_results: { outcome: { value: "went_well" }, rating: { value: "5" }, email: { value: "sarah.new@example.com" } } },
    },
  });
  assert.equal(pc.status, 200, JSON.stringify(pc.body));
  assert.equal(pc.body.outcome, "went_well");
  const saved = await callFor(happy);
  assert.equal(saved.outcome, "went_well");
  assert.equal(saved.rating, 5);
  assert.equal(saved.transcript.length, 4);
  assert.ok(saved.summary);
  h = await job(happy);
  assert.equal(h.checkin_status, "went_well");
  assert.equal(h.checkin_rating, 5);
  ok("send_referral emailed the link mid-call; post-call saved outcome went_well, 5/5, summary and transcript");

  // 5. The referral page and submissions
  const page = await fetch(`${BASE}/r/${h.referral_token}`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Refer 5 friends, get a \$100 gift card/);
  assert.equal((await fetch(`${BASE}/r/00000000-0000-0000-0000-000000000000`)).status, 404);
  const token = h.referral_token;
  const noPerm = await post("/api/referrals", { token, rows: [{ name: "Ann", phone: num(10) }], permission: false });
  assert.equal(noPerm.status, 400);
  const bad = await post("/api/referrals", { token, rows: [{ name: "", phone: num(10) }], permission: true });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.problems[0].index, 0);
  const r1 = await post("/api/referrals", { token, permission: true, rows: [
    { name: "Ann Friend", phone: num(10), email: "ann@example.com", address: "10 Elm St, Plano" },
    { name: "Bob Friend", phone: num(11) },
    { name: "Larry Again", phone: num(1) }, // already a customer of this roofer
  ] });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.deepEqual(r1.body.added, ["Ann Friend", "Bob Friend"]);
  assert.equal(r1.body.skipped[0].name, "Larry Again");
  assert.equal(r1.body.earned, false);
  const r2 = await post("/api/referrals", { token, permission: true, rows: [
    { name: "Cat Friend", phone: num(12) },
    { name: "Dan Friend", phone: num(13) },
    { name: "Eve Friend", phone: num(14), email: "eve@example.com" },
  ] });
  assert.equal(r2.body.total, 5);
  assert.equal(r2.body.earned, true);
  const full = await post("/api/referrals", { token, permission: true, rows: [{ name: "Fay", phone: num(15) }] });
  assert.equal(full.status, 400);
  h = await job(happy);
  assert.ok(h.gift_card_owed_at);
  assert.equal(h.gift_card_cents, 10000);
  ok(`/r/{token} renders (404 for a bad token); permission required; an existing customer isn't counted; 5 referrals → $100 gift card owed`);

  // 6. Referred people are never in the voice queue
  const phones = [10, 11, 12, 13, 14].map(num);
  const { data: refs } = await db.from("customer_referrals").select("name, phone, status, permission_text").eq("agent_id", agentId);
  assert.equal(refs.length, 5);
  assert.ok(refs.every((r) => r.status === "new" && /permission/.test(r.permission_text)));
  const { count: asLeads } = await db.from("quote_requests").select("id", { count: "exact", head: true }).eq("agent_id", agentId).in("phone", phones);
  const { count: called } = await db.from("voice_calls").select("id", { count: "exact", head: true }).eq("agent_id", agentId).in("to_number", phones);
  assert.equal(asLeads, 0);
  assert.equal(called, 0);
  ok("the 5 referred people are only in customer_referrals: none in quote_requests, none ever called");

  // 7. A problem: report_issue alerts the roofer, and a "went well" in the analysis can't override it
  await post("/api/jobs/completed", { booking_id: unhappy }, { "x-job-secret": agent.job_webhook_token });
  await due(unhappy);
  await cron();
  const uc = await callFor(unhappy);
  const issue = await tool("report_issue", { job_id: unhappy, details: "Gutter left loose on the north side", rating: 2 });
  assert.equal(issue.body.ok, true, JSON.stringify(issue.body));
  assert.match(issue.body.message, /don't mention referrals/);
  const upc = await signed({ type: "post_call_transcription", data: { conversation_id: uc.conversation_id, transcript: [{ role: "user", message: "The gutter is loose." }], metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000) - 60, call_duration_secs: 55 }, analysis: { data_collection_results: { outcome: { value: "went_well" } } } } });
  assert.equal(upc.body.outcome, "issue");
  const u = await job(unhappy);
  assert.equal(u.checkin_status, "issue");
  assert.equal(u.checkin_rating, 2);
  assert.ok(u.checkin_alerted_at);
  assert.equal(u.referral_email_sent_at, null, "no referral pitch after a problem");
  ok("report_issue alerted the roofer, outcome stays issue (2/5), no referral email");

  // 8. No answer: retried once the next day, then the email goes on its own
  await post("/api/jobs/completed", { booking_id: missed }, { "x-job-secret": agent.job_webhook_token });
  await due(missed);
  await cron();
  const m1 = await callFor(missed);
  await signed({ type: "call_initiation_failure", data: { conversation_id: m1.conversation_id, failure_reason: "no-answer" } });
  let m = await job(missed);
  assert.equal(m.checkin_status, "scheduled");
  const hours = (new Date(m.checkin_next_call_at) - Date.now()) / 3600_000;
  assert.ok(hours > 12 && hours < 36, `retry in ${hours}h`);
  await due(missed);
  await cron();
  const m2 = await callFor(missed);
  assert.equal(m2.attempt, 2);
  assert.equal(m2.reason, "retry");
  await signed({ type: "call_initiation_failure", data: { conversation_id: m2.conversation_id, failure_reason: "no-answer" } });
  m = await job(missed);
  assert.equal(m.checkin_status, "no_answer");
  assert.ok(m.referral_email_sent_at, "the email went after the last try");
  ok(`no answer → retry in ${Math.round(hours)}h; no answer again → stops, referral email sent instead`);

  // 9. do_not_call on a check-in
  const dnc = await tool("do_not_call", { job_id: unhappy });
  assert.equal(dnc.body.ok, true);
  const { data: dncRow } = await db.from("voice_do_not_call").select("phone").eq("phone", num(2)).maybeSingle();
  assert.ok(dncRow);
  await db.from("voice_do_not_call").delete().eq("phone", num(2));
  ok("do_not_call with job_id adds them to the do-not-call list");

  console.log("\nall check-in and referral checks passed");
} finally {
  if (agentId) {
    await db.from("voice_do_not_call").delete().in("phone", [0, 1, 2, 3].map(num));
    await db.from("agents").delete().eq("id", agentId);
    console.log(`cleaned up ${slug}`);
  }
}
