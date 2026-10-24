import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSlackMessage } from "@/lib/slack";
import { referralCreditCents, selfReferral, slugFor, validateJoin, type JoinInput } from "@/lib/referrals-core";

// Affiliates: an agent who brings in another agent earns 1% of every deposit that agent makes, as ad
// credit in their own wallet (see referrals-core.ts for the numbers). This file is the database side:
// the credit row a deposit adds, join requests from /join/<slug>, the Affiliates tab and the admin panel.
// Everything degrades to "no referrals" until the affiliates migration has run.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type WalletRow = {
  agent_id: string;
  kind: string;
  amount_cents: number;
  status: "completed";
  description: string;
  external_id: string;
  related_agent_id?: string;
};

/**
 * The referrer's credit row for a paid deposit, or null when there's none to give: no referrer, their
 * credit is paused, they're no longer active, or it's the same person. Never throws (a deposit must
 * always record), and returns null before the migration runs.
 */
export async function referralRowFor(input: { agentId: string; depositCents: number; sessionId: string; customerId: string | null }): Promise<WalletRow | null> {
  try {
    const { data: agent, error } = await supabaseAdmin
      .from("agents")
      .select("id, full_name, email, stripe_customer_id, referred_by")
      .eq("id", input.agentId)
      .maybeSingle();
    if (error || !agent?.referred_by) return null;
    const { data: referrer } = await supabaseAdmin
      .from("agents")
      .select("id, email, stripe_customer_id, active, referral_paused")
      .eq("id", agent.referred_by)
      .maybeSingle();
    if (!referrer?.active || referrer.referral_paused) return null;
    if (selfReferral({ ...agent, stripe_customer_id: input.customerId ?? agent.stripe_customer_id }, referrer)) return null;
    const credit = referralCreditCents(input.depositCents);
    if (credit <= 0) return null;
    return {
      agent_id: referrer.id,
      kind: "referral_credit",
      amount_cents: credit,
      status: "completed",
      description: `Referral credit: 1% of ${agent.full_name}'s ${usd(input.depositCents)} deposit`,
      external_id: `${input.sessionId}:referral`,
      related_agent_id: agent.id,
    };
  } catch (e) {
    console.error("referral credit lookup failed", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------- The Affiliates tab ----------

export type AffiliateSummary = {
  ready: boolean; // false until the migration has run
  link: string;
  earnedCents: number; // all time, after any refunds
  monthCents: number; // this calendar month, in the agent's timezone
  referrals: { id: string; name: string; joinedAt: string; creditCents: number }[];
  requests: { id: string; name: string; status: "pending" | "approved" | "declined"; createdAt: string }[];
  credits: { id: string; amountCents: number; description: string; createdAt: string }[];
};

export async function getAffiliateSummary(agent: { id: string; slug: string; timezone: string }): Promise<AffiliateSummary> {
  const link = `${appUrl()}/join/${agent.slug}`;
  const empty: AffiliateSummary = { ready: false, link, earnedCents: 0, monthCents: 0, referrals: [], requests: [], credits: [] };
  const [refs, credits, requests] = await Promise.all([
    supabaseAdmin.from("agents").select("id, full_name, referred_at, created_at").eq("referred_by", agent.id).order("referred_at", { ascending: false }),
    supabaseAdmin
      .from("wallet_transactions")
      .select("id, amount_cents, description, related_agent_id, created_at")
      .eq("agent_id", agent.id)
      .eq("kind", "referral_credit")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin.from("referral_requests").select("id, full_name, status, created_at").eq("referrer_id", agent.id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (refs.error || requests.error) return empty;

  const monthStart = DateTime.now().setZone(agent.timezone).startOf("month").toMillis();
  const byReferral = new Map<string, number>();
  let earnedCents = 0;
  let monthCents = 0;
  for (const c of credits.data ?? []) {
    earnedCents += c.amount_cents;
    if (new Date(c.created_at).getTime() >= monthStart) monthCents += c.amount_cents;
    if (c.related_agent_id) byReferral.set(c.related_agent_id, (byReferral.get(c.related_agent_id) ?? 0) + c.amount_cents);
  }
  return {
    ready: true,
    link,
    earnedCents,
    monthCents,
    referrals: (refs.data ?? []).map((r) => ({ id: r.id, name: r.full_name, joinedAt: r.referred_at ?? r.created_at, creditCents: byReferral.get(r.id) ?? 0 })),
    // Approved requests show as referrals above, so the list here is only what's still open or declined
    requests: (requests.data ?? []).filter((r) => r.status !== "approved").map((r) => ({ id: r.id, name: r.full_name, status: r.status, createdAt: r.created_at })),
    credits: (credits.data ?? []).slice(0, 20).map((c) => ({ id: c.id, amountCents: c.amount_cents, description: c.description ?? "Referral credit", createdAt: c.created_at })),
  };
}

// ---------- Join requests (/join/<slug>) ----------

export type JoinResult = { ok: true; name: string } | { ok: false; error?: string; errors?: Partial<Record<keyof JoinInput, string>> };

async function pingStaff(text: string, blocks?: unknown[]) {
  const to = process.env.ANRYH_ALERT_SLACK_ID;
  if (!to || !process.env.SLACK_BOT_TOKEN) return;
  try {
    await sendSlackMessage(to, text, blocks);
  } catch (e) {
    console.error("affiliates: couldn't reach Slack", e instanceof Error ? e.message : e);
  }
}

export async function submitJoinRequest(referrerSlug: string, input: Partial<JoinInput>): Promise<JoinResult> {
  const checked = validateJoin(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const v = checked.value;

  const { data: referrer } = await supabaseAdmin.from("agents").select("id, full_name, email").eq("slug", referrerSlug).eq("active", true).maybeSingle();
  if (!referrer) return { ok: false, error: "This invite link isn't active any more. Ask the agent who sent it for a new one." };
  if (v.email === referrer.email.toLowerCase()) return { ok: false, errors: { email: "That's the email of the agent who invited you. Use your own." } };

  const { data: existing } = await supabaseAdmin.from("agents").select("id").ilike("email", v.email).limit(1);
  if (existing?.length) return { ok: false, error: "That email already has a Migz account. Sign in at anryhlabs.com/login instead." };

  const { error } = await supabaseAdmin.from("referral_requests").insert({
    referrer_id: referrer.id,
    full_name: v.fullName,
    email: v.email,
    phone: v.phone,
    licensed_states: v.states,
    note: v.note,
  });
  if (error?.code === "23505") return { ok: true, name: v.fullName.split(" ")[0] }; // already asked: same answer, no second ping
  if (error) {
    console.error("join request failed", error.message);
    return { ok: false, error: "That didn't send. Try again in a minute." };
  }

  const detail = [v.email, v.phone, v.states.length ? `licensed in ${v.states.join(", ")}` : null].filter(Boolean).join(" · ");
  await pingStaff(`New request to join Migz: ${v.fullName}, invited by ${referrer.full_name}`, [
    { type: "section", text: { type: "mrkdwn", text: `:wave: *${esc(v.fullName)}* wants to join Migz\nInvited by *${esc(referrer.full_name)}*\n${esc(detail)}` } },
    ...(v.note ? [{ type: "context", elements: [{ type: "mrkdwn", text: esc(`“${v.note.slice(0, 280)}”`) }] }] : []),
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Review in the admin dashboard" }, url: `${appUrl()}/admin#affiliates`, style: "primary" }] },
  ]);
  return { ok: true, name: v.fullName.split(" ")[0] };
}

// ---------- Admin ----------

export type AdminAffiliates = {
  ready: boolean;
  pending: { id: string; name: string; email: string; phone: string | null; states: string[]; note: string | null; referrer: string; createdAt: string }[];
  decided: { id: string; name: string; status: string; referrer: string; decidedAt: string | null }[];
  agents: {
    id: string;
    name: string;
    slug: string;
    referredBy: string | null;
    paused: boolean;
    referrals: number;
    referralDepositsCents: number; // what their referrals deposited since being linked
    earnedCents: number;
  }[];
};

export async function getAdminAffiliates(): Promise<AdminAffiliates> {
  const [agents, requests, credits] = await Promise.all([
    supabaseAdmin.from("agents").select("id, full_name, slug, referred_by, referred_at, referral_paused").order("full_name"),
    supabaseAdmin.from("referral_requests").select("id, referrer_id, full_name, email, phone, licensed_states, note, status, decided_at, created_at").order("created_at", { ascending: false }).limit(100),
    supabaseAdmin.from("wallet_transactions").select("agent_id, amount_cents").eq("kind", "referral_credit").eq("status", "completed"),
  ]);
  if (agents.error || requests.error) return { ready: false, pending: [], decided: [], agents: [] };

  const list = agents.data ?? [];
  const name = new Map(list.map((a) => [a.id, a.full_name as string]));
  const referred = list.filter((a) => a.referred_by);
  // Deposits by referred agents since they were linked
  const { data: deposits } = referred.length
    ? await supabaseAdmin.from("wallet_transactions").select("agent_id, amount_cents, created_at").eq("kind", "deposit").eq("status", "completed").in("agent_id", referred.map((a) => a.id))
    : { data: [] as { agent_id: string; amount_cents: number; created_at: string }[] };
  const linkedAt = new Map(referred.map((a) => [a.id, a.referred_at ? new Date(a.referred_at).getTime() : 0]));
  const depositsBy = new Map<string, number>();
  for (const d of deposits ?? []) {
    if (new Date(d.created_at).getTime() < (linkedAt.get(d.agent_id) ?? 0)) continue;
    depositsBy.set(d.agent_id, (depositsBy.get(d.agent_id) ?? 0) + d.amount_cents);
  }
  const earned = new Map<string, number>();
  for (const c of credits.data ?? []) earned.set(c.agent_id, (earned.get(c.agent_id) ?? 0) + c.amount_cents);

  return {
    ready: true,
    pending: (requests.data ?? [])
      .filter((r) => r.status === "pending")
      .map((r) => ({ id: r.id, name: r.full_name, email: r.email, phone: r.phone, states: r.licensed_states ?? [], note: r.note, referrer: name.get(r.referrer_id) ?? "an agent", createdAt: r.created_at })),
    decided: (requests.data ?? [])
      .filter((r) => r.status !== "pending")
      .slice(0, 10)
      .map((r) => ({ id: r.id, name: r.full_name, status: r.status, referrer: name.get(r.referrer_id) ?? "an agent", decidedAt: r.decided_at })),
    agents: list.map((a) => {
      const mine = referred.filter((r) => r.referred_by === a.id);
      return {
        id: a.id,
        name: a.full_name,
        slug: a.slug,
        referredBy: a.referred_by,
        paused: !!a.referral_paused,
        referrals: mine.length,
        referralDepositsCents: mine.reduce((s, r) => s + (depositsBy.get(r.id) ?? 0), 0),
        earnedCents: earned.get(a.id) ?? 0,
      };
    }),
  };
}

type Done = { ok: true; message: string } | { ok: false; error: string };

/**
 * Approves a join request: creates the agent's account (their booking page address from their name)
 * linked to the referrer, and their login, so they can sign in at /login with their email straight away.
 */
export async function approveJoinRequest(id: string, staff: string): Promise<Done> {
  const { data: req } = await supabaseAdmin.from("referral_requests").select("*").eq("id", id).maybeSingle();
  if (!req) return { ok: false, error: "That request is gone." };
  if (req.status !== "pending") return { ok: false, error: `That request was already ${req.status}.` };
  const email = String(req.email).toLowerCase();

  const { data: referrer } = await supabaseAdmin.from("agents").select("id, full_name, email, slack_user_id, active").eq("id", req.referrer_id).maybeSingle();
  if (!referrer) return { ok: false, error: "The agent who referred them no longer exists." };
  if (email === referrer.email.toLowerCase()) return { ok: false, error: "That's the referrer's own email." };
  const { data: existing } = await supabaseAdmin.from("agents").select("id, full_name").ilike("email", email).limit(1);
  if (existing?.length) return { ok: false, error: `${existing[0].full_name} already has an account with this email. Link the referrer to it below instead, then decline this request.` };

  const { data: slugs } = await supabaseAdmin.from("agents").select("slug");
  const slug = slugFor(req.full_name, new Set((slugs ?? []).map((s) => s.slug)));
  const now = new Date().toISOString();
  const { data: created, error } = await supabaseAdmin
    .from("agents")
    .insert({ slug, full_name: req.full_name, email, licensed_states: req.licensed_states ?? [], active: true, referred_by: referrer.id, referred_at: now })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: `Couldn't create the account: ${error?.message ?? "unknown error"}` };

  // Their login. Sign-in is by emailed code and never creates users, so the account needs one to exist.
  const auth = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true });
  const loginNote = auth.error && !/already|registered|exists/i.test(auth.error.message) ? ` Their login couldn't be created (${auth.error.message}): add it in Supabase Auth.` : "";

  await supabaseAdmin.from("referral_requests").update({ status: "approved", agent_id: created.id, decided_by: staff, decided_at: now }).eq("id", id);

  if (referrer.slack_user_id && referrer.active) {
    try {
      await sendSlackMessage(
        referrer.slack_user_id,
        `${req.full_name} just joined Migz through your invite link. From now on you get 1% of everything they add to their ad fund, as credit in your own ad funds.`,
      );
    } catch {
      // the referrer's note is a nicety
    }
  }
  return { ok: true, message: `${req.full_name} is set up at /${slug}, linked to ${referrer.full_name}. Tell them to sign in at ${appUrl().replace(/^https?:\/\//, "")}/login with ${email}.${loginNote}` };
}

export async function declineJoinRequest(id: string, staff: string): Promise<Done> {
  const { data, error } = await supabaseAdmin
    .from("referral_requests")
    .update({ status: "declined", decided_by: staff, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("full_name")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "That request isn't open any more." };
  return { ok: true, message: `Declined ${data.full_name}.` };
}

/** Links (or unlinks) an existing agent to the agent who referred them. Only deposits from now on earn credit. */
export async function setReferrer(agentId: string, referrerId: string | null): Promise<Done> {
  const { data: agent } = await supabaseAdmin.from("agents").select("id, full_name, email, stripe_customer_id, referred_by").eq("id", agentId).maybeSingle();
  if (!agent) return { ok: false, error: "That agent is gone." };
  if (!referrerId) {
    const { error } = await supabaseAdmin.from("agents").update({ referred_by: null, referred_at: null }).eq("id", agentId);
    return error ? { ok: false, error: "Couldn't save that." } : { ok: true, message: `${agent.full_name} has no referrer now.` };
  }
  const { data: referrer } = await supabaseAdmin.from("agents").select("id, full_name, email, stripe_customer_id, referred_by").eq("id", referrerId).maybeSingle();
  if (!referrer) return { ok: false, error: "That referrer is gone." };
  const why = selfReferral(agent, referrer);
  if (why) return { ok: false, error: why };
  if (referrer.referred_by === agent.id) return { ok: false, error: `${referrer.full_name} was referred by ${agent.full_name}, so they can't refer each other.` };
  if (agent.referred_by === referrerId) return { ok: true, message: "No change." };
  const { error } = await supabaseAdmin.from("agents").update({ referred_by: referrerId, referred_at: new Date().toISOString() }).eq("id", agentId);
  if (error) return { ok: false, error: "Couldn't save that." };
  return { ok: true, message: `${agent.full_name} is now ${referrer.full_name}'s referral. Their deposits from now on earn ${referrer.full_name} 1%.` };
}

/** Stops (or restarts) an agent earning referral credit, e.g. while something looks off. Past credit stays. */
export async function setReferralPaused(agentId: string, paused: boolean): Promise<Done> {
  const { data, error } = await supabaseAdmin.from("agents").update({ referral_paused: paused }).eq("id", agentId).select("full_name").maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't save that." };
  return { ok: true, message: paused ? `${data.full_name} won't earn referral credit until you turn it back on.` : `${data.full_name} earns referral credit again.` };
}
