import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { landingUrl } from "@/lib/booking/sites";
import { logActivity } from "@/lib/dashboard/activity";
import { sendSlackMessage } from "@/lib/slack";
import { resend, validWebhookUrl } from "@/lib/roofing/notify";
import { giftCardOwedEmail, referralIntroEmail, referralsAddedEmail } from "@/lib/roofing/referral-emails";
import { cleanReferralRows, dollars, REFERRAL_PERMISSION_TEXT, type ReferralRow, type RowProblem } from "@/lib/voice/checkin-rules";

// The referral page (/r/{token}) and what follows a submission. Referred people gave no consent of their own, so
// they're NEVER called by the voice agent or texted automatically: they live only in customer_referrals (never in
// quote_requests, where the voice queue looks), the roofer is emailed, their CRM gets each one marked as a
// referral, and the dashboard lists them for a call by hand. The one optional email to each referral is off by
// default and needs the roofer's postal address.

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReferrerJob = { id: string; agent_id: string; name: string; email: string | null; phone: string; job_done_at: string | null; gift_card_owed_at: string | null; gift_card_sent_at: string | null; agents: Agent };

async function jobByToken(token: string): Promise<ReferrerJob | null> {
  if (!UUID.test(token)) return null;
  const { data } = await supabaseAdmin
    .from("bookings")
    .select("id, agent_id, name, email, phone, job_done_at, gift_card_owed_at, gift_card_sent_at, agents(*)")
    .eq("referral_token", token)
    .maybeSingle();
  return (data as unknown as ReferrerJob) ?? null;
}

export type ReferralPage = {
  company: string;
  photoUrl: string | null;
  license: string | null;
  customerFirstName: string;
  rewardCents: number;
  goal: number;
  referred: { name: string }[];
  earned: boolean;
};

export async function getReferralPage(token: string): Promise<ReferralPage | null> {
  const job = await jobByToken(token);
  if (!job || (job.agents as Agent & { active?: boolean }).active === false) return null;
  const { data: rows } = await supabaseAdmin.from("customer_referrals").select("name").eq("booking_id", job.id).order("created_at");
  return {
    company: job.agents.full_name,
    photoUrl: job.agents.photo_url,
    license: job.agents.company_license ?? null,
    customerFirstName: job.name.trim().split(/\s+/)[0] ?? "",
    rewardCents: job.agents.referral_reward_cents ?? 10000,
    goal: job.agents.referral_goal ?? 5,
    referred: (rows ?? []).map((r) => ({ name: r.name.trim().split(/\s+/)[0] ?? r.name })),
    earned: !!job.gift_card_owed_at,
  };
}

const phoneKey = (p: string) => p.replace(/\D/g, "").slice(-10);

/** Who's already known to this roofer (a referral, a lead, a customer), by phone and email. */
async function knownContacts(agentId: string, rows: ReferralRow[]) {
  const phones = rows.map((r) => r.phone);
  const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
  const or = (cols: [string, string[]][]) => cols.filter(([, v]) => v.length).map(([c, v]) => `${c}.in.(${v.map((x) => `"${x}"`).join(",")})`).join(",");
  const filter = or([["phone", phones], ["email", emails]]);
  const [refs, leads, bookings] = await Promise.all([
    supabaseAdmin.from("customer_referrals").select("phone, email").eq("agent_id", agentId).or(filter),
    supabaseAdmin.from("quote_requests").select("phone, email").eq("agent_id", agentId).or(filter),
    supabaseAdmin.from("bookings").select("phone, email").eq("agent_id", agentId).or(filter),
  ]);
  const known = new Set<string>();
  for (const r of [...(refs.data ?? []), ...(leads.data ?? []), ...(bookings.data ?? [])]) {
    if (r.phone) known.add(phoneKey(r.phone));
    if (r.email) known.add(r.email.toLowerCase());
  }
  return known;
}

export type SubmitResult =
  | { ok: true; added: string[]; skipped: { name: string; reason: string }[]; total: number; goal: number; earned: boolean }
  | { ok: false; status: number; error: string; problems?: RowProblem[] };

export async function submitReferrals(token: string, input: { rows: unknown; permission: unknown }): Promise<SubmitResult> {
  const job = await jobByToken(token);
  if (!job || (job.agents as Agent & { active?: boolean }).active === false) return { ok: false, status: 404, error: "This link isn't valid any more." };
  if (input.permission !== true) return { ok: false, status: 400, error: "Please confirm you have their permission to share their details." };
  const agent = job.agents;
  const goal = agent.referral_goal ?? 5;

  const { count: before } = await supabaseAdmin.from("customer_referrals").select("id", { count: "exact", head: true }).eq("booking_id", job.id);
  const room = Math.max(0, goal - (before ?? 0));
  if (!room) return { ok: false, status: 400, error: `You've already referred ${goal} people. Thank you!` };
  const { rows, problems } = cleanReferralRows(input.rows, room);
  if (problems.length) return { ok: false, status: 400, error: "Please fix the highlighted rows.", problems };
  if (!rows.length) return { ok: false, status: 400, error: "Add at least one person." };

  // The customer themself, and anyone the roofer already knows, don't count
  const known = await knownContacts(agent.id, rows);
  known.add(phoneKey(job.phone));
  if (job.email) known.add(job.email.toLowerCase());
  const fresh: ReferralRow[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const r of rows) {
    if (known.has(phoneKey(r.phone)) || (r.email && known.has(r.email))) skipped.push({ name: r.name, reason: "already in touch with us" });
    else fresh.push(r);
  }

  const added: (ReferralRow & { id: string })[] = [];
  for (const r of fresh) {
    // One at a time, so a duplicate (unique per roofer by phone or email) skips just that row
    const { data, error } = await supabaseAdmin
      .from("customer_referrals")
      .insert({ agent_id: agent.id, booking_id: job.id, name: r.name, phone: r.phone, email: r.email, address: r.address, permission_text: REFERRAL_PERMISSION_TEXT })
      .select("id")
      .single();
    if (error?.code === "23505") skipped.push({ name: r.name, reason: "already referred" });
    else if (error || !data) {
      console.error("[referrals] insert failed", error);
      return { ok: false, status: 500, error: "Something went wrong. Please try again." };
    } else added.push({ ...r, id: data.id });
  }

  const total = (before ?? 0) + added.length;
  let earned = !!job.gift_card_owed_at;
  if (added.length) {
    await notifyRoofer(agent, job, added, total, goal);
    for (const r of added) await sendReferralToCrm(agent, job, r);
    if (agent.referral_intro_email) for (const r of added) await sendIntroEmail(agent, job, r);
    await logActivity(agent.id, { kind: "call", id: job.id }, "note", `Referred ${added.length}: ${added.map((r) => r.name).join(", ")} (${total} of ${goal}).`);
    if (total >= goal && !earned) earned = await markGiftCardOwed(agent, job);
  }
  return { ok: true, added: added.map((r) => r.name), skipped, total, goal, earned };
}

async function notifyRoofer(agent: Agent, job: ReferrerJob, added: ReferralRow[], total: number, goal: number) {
  const email = referralsAddedEmail({ customerName: job.name, referrals: added, total, goal, dashboardUrl: `${appUrl()}/dashboard/referrals` });
  await resend({ to: [agent.business_email || agent.email], subject: email.subject, html: email.html, text: email.text }, `referrals/${job.id}/${total}`).catch((e) => console.error("[referrals] roofer email failed", e));
  if (agent.slack_user_id)
    await sendSlackMessage(agent.slack_user_id, `:handshake: *${job.name}* referred ${added.map((r) => r.name).join(", ")} (${total} of ${goal}). Call them by hand: ${appUrl()}/dashboard/referrals`).catch(() => {});
}

/** What the roofer's CRM webhook receives for a referral: flat fields, marked as a referral, never as a booked lead. */
export function referralCrmPayload(agent: Pick<Agent, "full_name">, job: { id: string; name: string }, r: ReferralRow & { id: string }) {
  const [first, ...rest] = r.name.trim().split(/\s+/);
  return {
    event: "referral.created",
    referral_id: r.id,
    company: agent.full_name,
    name: r.name,
    first_name: first ?? "",
    last_name: rest.join(" "),
    phone: r.phone,
    email: r.email,
    address: r.address,
    referred_by: job.name,
    referred_by_booking_id: job.id,
    source: "Referral",
    contact_note: "Referred by a customer. Call by hand: no consent for automated calls or texts.",
  };
}

async function sendReferralToCrm(agent: Agent, job: ReferrerJob, r: ReferralRow & { id: string }) {
  if (!agent.crm_webhook_url || !validWebhookUrl(agent.crm_webhook_url)) return;
  let error: string | null = null;
  try {
    const res = await fetch(agent.crm_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "MigzAI-Webhook/1" },
      body: JSON.stringify(referralCrmPayload(agent, job, r)),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "failed";
  }
  await supabaseAdmin.from("customer_referrals").update(error ? { crm_error: error } : { crm_sent_at: new Date().toISOString(), crm_error: null }).eq("id", r.id);
}

async function sendIntroEmail(agent: Agent, job: ReferrerJob, r: ReferralRow & { id: string }) {
  if (!r.email || !agent.mailing_address?.trim()) return; // CAN-SPAM: no postal address, no marketing email
  const page = landingUrl(agent.slug, appUrl()).split("#")[0];
  const email = referralIntroEmail({ company: agent.full_name, customerName: job.name, referralName: r.name, bookUrl: `${page}?utm_source=referral&utm_medium=email`, mailingAddress: agent.mailing_address.trim() });
  try {
    await resend({ from: `${agent.full_name.replace(/[<>"]/g, "")} <${process.env.BOOKING_EMAIL_FROM}>`, to: [r.email], reply_to: agent.business_email || agent.email, subject: email.subject, html: email.html, text: email.text }, `referral-intro/${r.id}`);
    await supabaseAdmin.from("customer_referrals").update({ intro_emailed_at: new Date().toISOString() }).eq("id", r.id);
  } catch (e) {
    console.error("[referrals] intro email failed", e);
  }
}

async function markGiftCardOwed(agent: Agent, job: ReferrerJob) {
  const cents = agent.referral_reward_cents ?? 10000;
  if (cents <= 0) return false;
  const { data: claim } = await supabaseAdmin.from("bookings").update({ gift_card_owed_at: new Date().toISOString(), gift_card_cents: cents }).eq("id", job.id).is("gift_card_owed_at", null).select("id").maybeSingle();
  if (!claim) return true;
  const goal = agent.referral_goal ?? 5;
  const email = giftCardOwedEmail({ customerName: job.name, email: job.email, phone: job.phone, cents, goal, dashboardUrl: `${appUrl()}/dashboard/referrals` });
  await resend({ to: [agent.business_email || agent.email], subject: email.subject, html: email.html, text: email.text }, `gift-card/${job.id}`).catch((e) => console.error("[referrals] gift card email failed", e));
  if (agent.slack_user_id) await sendSlackMessage(agent.slack_user_id, `:gift: *${job.name}* referred ${goal} people and earned a ${dollars(cents)} gift card. Mark it sent once you've sent it: ${appUrl()}/dashboard/referrals`).catch(() => {});
  await logActivity(agent.id, { kind: "call", id: job.id }, "note", `Earned a ${dollars(cents)} gift card for ${goal} referrals.`);
  return true;
}

// ---------- The dashboard ----------

export type ReferralListItem = { id: string; name: string; phone: string; email: string | null; address: string | null; status: string; createdAt: string; referredBy: string; referredById: string; crmError: string | null };
export type GiftCardItem = { bookingId: string; name: string; email: string | null; phone: string; cents: number; owedAt: string; sentAt: string | null };

export async function getReferralsDashboard(agentId: string): Promise<{ referrals: ReferralListItem[]; giftCards: GiftCardItem[]; ready: boolean }> {
  const [refs, cards] = await Promise.all([
    supabaseAdmin.from("customer_referrals").select("id, name, phone, email, address, status, created_at, crm_error, booking_id, bookings(name)").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(500),
    supabaseAdmin.from("bookings").select("id, name, email, phone, gift_card_cents, gift_card_owed_at, gift_card_sent_at").eq("agent_id", agentId).not("gift_card_owed_at", "is", null).order("gift_card_owed_at", { ascending: false }).limit(200),
  ]);
  if (refs.error || cards.error) return { referrals: [], giftCards: [], ready: false }; // before the migration
  return {
    ready: true,
    referrals: (refs.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      address: r.address,
      status: r.status,
      createdAt: r.created_at,
      referredBy: (r.bookings as unknown as { name: string } | null)?.name ?? "A customer",
      referredById: r.booking_id,
      crmError: r.crm_error,
    })),
    giftCards: (cards.data ?? []).map((b) => ({ bookingId: b.id, name: b.name, email: b.email, phone: b.phone, cents: b.gift_card_cents ?? 0, owedAt: b.gift_card_owed_at!, sentAt: b.gift_card_sent_at })),
  };
}
