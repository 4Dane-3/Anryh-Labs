// Affiliates end to end against the real database, with throwaway agents only (cleanup deletes just
// them, their wallet rows and requests, and the test login). No Slack: the tokens are removed first.
// Run: NODE_PATH=scripts/migz/stubs npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/migz/affiliates.e2e.mts
import assert from "node:assert/strict";

(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
delete process.env.SLACK_BOT_TOKEN;
delete process.env.ANRYH_ALERT_SLACK_ID;

const { supabaseAdmin: db } = await import("@/lib/supabase-admin");
const { recordDeposit, recordReversal } = await import("@/lib/stripe");
const refs = await import("@/lib/referrals");

const tag = Math.random().toString(36).slice(2, 8);
const ids: string[] = [];
const authIds: string[] = [];
const newAgent = async (name: string, extra: Record<string, unknown> = {}) => {
  const slug = `e2e-aff-${name}-${tag}`;
  const { data, error } = await db.from("agents").insert({ slug, full_name: `E2E ${name} ${tag}`, email: `${slug}@example.com`, active: true, ...extra }).select("id, slug").single();
  if (error) throw error;
  ids.push(data.id);
  return data as { id: string; slug: string };
};
const wallet = async (agentId: string) =>
  (await db.from("wallet_transactions").select("kind, amount_cents, external_id, related_agent_id").eq("agent_id", agentId).order("created_at")).data!;
const balance = async (agentId: string) => (await wallet(agentId)).reduce((s, r) => s + r.amount_cents, 0);
const session = (id: string, agentId: string, cents: number, customer: string | null = null) =>
  ({ id, amount_total: cents, metadata: { agent_id: agentId, kind: "ad_funds", deposit_cents: String(cents) }, client_reference_id: agentId, customer }) as never;
const ok = (m: string) => console.log(`  ✓ ${m}`);
let failed = false;

try {
  const R = await newAgent("referrer");
  const A = await newAgent("referred", { referred_by: R.id, referred_at: new Date().toISOString() });
  const S1 = `cs_test_e2e_${tag}_1`;

  console.log("\n▶ 1. A referred agent's deposit credits the referrer 1%, once");
  assert.equal(await recordDeposit(session(S1, A.id, 35_000)), true);
  assert.equal(await balance(A.id), 28_000, "the agent gets $280 of ad funds");
  const rw = await wallet(R.id);
  assert.deepEqual(rw.map((r) => [r.kind, r.amount_cents, r.external_id, r.related_agent_id]), [["referral_credit", 350, `${S1}:referral`, A.id]]);
  assert.equal(await recordDeposit(session(S1, A.id, 35_000)), false, "Stripe's retry is ignored");
  assert.equal(await balance(R.id), 350, "still one credit");
  ok("$350 deposit → agent $280, referrer +$3.50; a repeated webhook adds nothing");

  console.log("\n▶ 2. No credit for an agent nobody referred, or while the referrer's credit is paused");
  const B = await newAgent("solo");
  await recordDeposit(session(`cs_test_e2e_${tag}_b`, B.id, 35_000));
  assert.equal((await db.from("wallet_transactions").select("id").like("external_id", `cs_test_e2e_${tag}_b:referral`)).data!.length, 0);
  await refs.setReferralPaused(R.id, true);
  await recordDeposit(session(`cs_test_e2e_${tag}_p`, A.id, 70_000));
  assert.equal(await balance(R.id), 350, "paused: no credit");
  await refs.setReferralPaused(R.id, false);
  ok("unreferred and paused deposits earn nothing");

  console.log("\n▶ 3. Same person can't earn: same card customer");
  await db.from("agents").update({ stripe_customer_id: `cus_e2e_${tag}` }).eq("id", R.id);
  await recordDeposit(session(`cs_test_e2e_${tag}_c`, A.id, 35_000, `cus_e2e_${tag}`));
  assert.equal(await balance(R.id), 350, "a deposit paid by the referrer's own Stripe customer earns nothing");
  await db.from("agents").update({ stripe_customer_id: null }).eq("id", R.id);
  ok("paying with the referrer's own Stripe customer earns no credit");

  console.log("\n▶ 4. A half refund takes back half: the agent loses only ad money, the referrer half the credit");
  const before = await balance(A.id);
  const moved = await recordReversal({ sessionId: S1, key: `re_e2e_${tag}_1`, amountCents: 17_500, reason: "refund" });
  assert.ok(moved && moved.creditBackCents === 175 && moved.adMoneyCents === 14_000);
  assert.equal(await balance(A.id), before - 14_000);
  assert.equal(await balance(R.id), 175);
  assert.equal(await recordReversal({ sessionId: S1, key: `re_e2e_${tag}_1`, amountCents: 17_500, reason: "refund" }), null, "repeat ignored");
  assert.equal(await balance(R.id), 175);
  assert.equal(await recordReversal({ sessionId: "cs_not_ours", key: `re_e2e_${tag}_x`, amountCents: 100, reason: "refund" }), null, "unknown deposit ignored");
  ok("$175 refund: agent −$140 ad money (the $35 fee share comes back), referrer −$1.75; repeats and unknown deposits ignored");

  console.log("\n▶ 5. A chargeback takes the rest back; winning it restores everything");
  const S2 = `cs_test_e2e_${tag}_2`;
  await recordDeposit(session(S2, A.id, 100_000));
  assert.equal(await balance(R.id), 1_175);
  const a0 = await balance(A.id);
  await recordReversal({ sessionId: S2, key: `dp_e2e_${tag}`, amountCents: 100_000, reason: "chargeback" });
  assert.equal(await balance(A.id), a0 - 80_000);
  assert.equal(await balance(R.id), 175);
  await recordReversal({ sessionId: S2, key: `dp_e2e_${tag}:won`, amountCents: 100_000, reason: "chargeback_won" });
  assert.equal(await balance(A.id), a0);
  assert.equal(await balance(R.id), 1_175);
  ok("$1,000 chargeback: agent −$800, referrer −$10; won: both restored");

  console.log("\n▶ 6. The Affiliates tab adds it up");
  const s = await refs.getAffiliateSummary({ id: R.id, slug: R.slug, timezone: "America/Chicago" });
  assert.equal(s.ready, true);
  assert.equal(s.earnedCents, 1_175);
  assert.equal(s.monthCents, 1_175);
  assert.deepEqual(s.referrals.map((r) => [r.id, r.creditCents]), [[A.id, 1_175]]);
  assert.ok(s.link.endsWith(`/join/${R.slug}`));
  assert.equal(s.credits.length, 5, "every credit and reversal is listed");
  ok("earned $11.75 net, all this month, per-referral credit, link, history");

  console.log("\n▶ 7. Joining: request, duplicate, approval creates a linked account and a login");
  const email = `e2e-aff-join-${tag}@example.com`;
  const bad = await refs.submitJoinRequest(R.slug, { fullName: "x", email: "nope" });
  assert.ok(!bad.ok && bad.errors?.email);
  assert.ok(!(await refs.submitJoinRequest("no-such-agent-zzz", { fullName: "Jane Doe", email })).ok, "a dead link says so");
  assert.ok(!(await refs.submitJoinRequest(R.slug, { fullName: "Jane Doe", email: `${A.slug}@example.com` })).ok, "an existing account is told to sign in");
  const sent = await refs.submitJoinRequest(R.slug, { fullName: `Jane E2E${tag}`, email, phone: "312-555-0100", states: "IL, Texas" });
  assert.ok(sent.ok);
  assert.ok((await refs.submitJoinRequest(R.slug, { fullName: `Jane E2E${tag}`, email: email.toUpperCase() })).ok, "asking twice is fine");
  const { data: reqs } = await db.from("referral_requests").select("id, status, licensed_states").eq("referrer_id", R.id);
  assert.equal(reqs!.length, 1, "one request per email");
  assert.deepEqual(reqs![0].licensed_states, ["IL", "TX"]);
  const admin = await refs.getAdminAffiliates();
  assert.ok(admin.ready && admin.pending.some((p) => p.id === reqs![0].id && p.referrer === `E2E referrer ${tag}`));
  const approved = await refs.approveJoinRequest(reqs![0].id, "e2e");
  assert.ok(approved.ok, !approved.ok ? approved.error : "");
  const { data: joined } = await db.from("agents").select("id, slug, referred_by, email, licensed_states").eq("email", email).single();
  ids.push(joined!.id);
  assert.equal(joined!.referred_by, R.id);
  assert.equal(joined!.slug, `jane-e2e${tag}`);
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const login = users.users.find((u) => u.email === email);
  assert.ok(login?.email_confirmed_at, "a confirmed login exists, so they can sign in with a code");
  authIds.push(login!.id);
  assert.ok(!(await refs.approveJoinRequest(reqs![0].id, "e2e")).ok, "can't approve twice");
  ok(`request → approved → /${joined!.slug} linked to the referrer, with a login`);

  console.log("\n▶ 8. Staff linking rules");
  assert.ok(!(await refs.setReferrer(R.id, R.id)).ok, "not themselves");
  assert.ok(!(await refs.setReferrer(R.id, A.id)).ok, "not each other");
  assert.ok((await refs.setReferrer(B.id, R.id)).ok);
  assert.equal((await db.from("agents").select("referred_by").eq("id", B.id).single()).data!.referred_by, R.id);
  assert.ok((await refs.setReferrer(B.id, null)).ok);
  ok("no self or two-way referral; link and unlink work");

  console.log("\nALL AFFILIATE STEPS PASSED");
} catch (e) {
  failed = true;
  console.error("\nAFFILIATES E2E FAILED", e);
} finally {
  for (const id of authIds) await db.auth.admin.deleteUser(id);
  await db.from("agents").update({ referred_by: null }).in("id", ids);
  const { error } = await db.from("agents").delete().in("id", ids);
  const { count } = await db.from("agents").select("id", { count: "exact", head: true }).like("slug", `%${tag}%`);
  console.log(`  test agents removed (${error ? `error: ${error.message}` : `${count} left`}), ${authIds.length} test login(s) removed`);
  process.exit(failed ? 1 : 0);
}
