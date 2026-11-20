import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { slugFor } from "@/lib/referrals-core";
import { resend } from "@/lib/roofing/notify";
import { appUrl } from "@/lib/crm/email";
import { isVertical, VERTICAL_LABELS, type Vertical } from "@/lib/verticals";

// Staff invite clients from the admin and choose their business type there, so setup never asks it. An invite
// makes the account (its booking page address from the name), its login (sign-in is by emailed code and never
// creates users) and, unless staff untick it, emails them the sign-in link.

type Done = { ok: true; message: string; link: string; emailed: boolean } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a new account of each type starts with: clinics offer a free consultation and have no job rules. */
function startingColumns(vertical: Vertical) {
  return vertical === "hair_clinic" ? { lead_goal: "inspection" } : {};
}

export async function inviteClient(input: { name: string; email: string; vertical: string; sendEmail: boolean }, staff: string): Promise<Done> {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 100);
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) return { ok: false, error: "Add the business name." };
  if (!EMAIL.test(email)) return { ok: false, error: "That email doesn't look right." };
  if (!isVertical(input.vertical)) return { ok: false, error: "Choose the business type." };
  const vertical = input.vertical;

  const { data: existing } = await supabaseAdmin.from("agents").select("id, full_name").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1);
  if (existing?.length) return { ok: false, error: `${existing[0].full_name} already has an account with this email. Change their business type in the list below instead.` };

  const { data: slugs } = await supabaseAdmin.from("agents").select("slug");
  const slug = slugFor(name, new Set((slugs ?? []).map((s) => s.slug)));
  const now = new Date().toISOString();
  const { data: created, error } = await supabaseAdmin
    .from("agents")
    .insert({ slug, full_name: name, email, active: true, vertical, vertical_chosen_at: now, invited_at: now, invited_by: staff, ...startingColumns(vertical) })
    .select("id")
    .single();
  if (error || !created) {
    if (error?.code === "23514" || error?.code === "42703" || error?.code === "PGRST204") return { ok: false, error: "The database isn't updated for invites yet (migration 20261220000000_invites.sql)." };
    return { ok: false, error: `Couldn't create the account: ${error?.message ?? "unknown error"}` };
  }

  const auth = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true });
  const loginNote = auth.error && !/already|registered|exists/i.test(auth.error.message) ? ` Their login couldn't be created (${auth.error.message}): add it in Supabase Auth.` : "";

  const link = `${appUrl()}/login`;
  let emailed = false;
  let emailNote = "";
  if (input.sendEmail) {
    const mail = inviteEmail({ name, email, vertical, link });
    try {
      const r = await resend({ to: [email], subject: mail.subject, html: mail.html, text: mail.text }, `invite/${created.id}`);
      emailed = !r.skipped;
      if (r.skipped) emailNote = " Email isn't set up here (RESEND_API_KEY), so send them the link yourself.";
    } catch (e) {
      emailNote = ` The email didn't send (${e instanceof Error ? e.message : "unknown error"}): send them the link yourself.`;
    }
  }
  return {
    ok: true,
    emailed,
    link,
    message: `${name} is set up as a ${VERTICAL_LABELS[vertical].toLowerCase()} at /${slug}.${emailed ? ` Invite sent to ${email}.` : ` They sign in at ${link} with ${email}.`}${emailNote}${loginNote}`,
  };
}

/** The invite email (pure, for the tests): where to sign in and what setup covers. */
export function inviteEmail(input: { name: string; email: string; vertical: Vertical; link: string }) {
  const what =
    input.vertical === "hair_clinic"
      ? "Migz AI runs your Meta ads for free consultations, and Emma, your AI assistant, calls new leads and books them."
      : input.vertical === "roofing"
        ? "Migz AI runs your Meta and Google ads for free roof inspections, and Emma, your AI assistant, calls new leads and books them."
        : "Migz AI runs your Meta ads and books calls with people shopping for life insurance.";
  const subject = "Your Migz AI setup is ready";
  const text = [
    `Hi ${input.name},`,
    "",
    `Your Migz AI account is ready. ${what}`,
    "",
    `Sign in to start your setup (about 15 minutes): ${input.link}`,
    `Use this email (${input.email}). We'll send you a code: there's no password.`,
    "",
    "Anryh Labs",
  ].join("\n");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;padding:24px 12px;font-family:${font};color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
<tr><td style="padding:28px 28px 8px;"><h1 style="margin:0;font:700 22px/1.3 ${font};">Your Migz AI setup is ready</h1>
<p style="margin:12px 0 0;font:400 15px/1.55 ${font};color:#334155;">Hi ${esc(input.name)}, your account is ready. ${esc(what)}</p></td></tr>
<tr><td style="padding:18px 28px 0;"><a href="${esc(input.link)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#2D7FF9;color:#fff;font:600 15px/1 ${font};text-decoration:none;">Start your setup</a></td></tr>
<tr><td style="padding:16px 28px 26px;"><p style="margin:0;font:400 13px/1.6 ${font};color:#64748b;">Sign in with ${esc(input.email)}. We'll email you a code: there's no password. Setup takes about 15 minutes.</p></td></tr>
</table></body></html>`;
  return { subject, html, text };
}

/** Staff change an account's business type. Only before setup is done: a running campaign was built for the old one. */
export async function assignVertical(agentId: string, vertical: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!isVertical(vertical)) return { ok: false, error: "Choose a business type." };
  const { data: agent } = await supabaseAdmin.from("agents").select("id, full_name, vertical, onboarding_completed_at").eq("id", agentId).maybeSingle();
  if (!agent) return { ok: false, error: "That account is gone." };
  if (agent.vertical === vertical) return { ok: true, message: `${agent.full_name} is already a ${VERTICAL_LABELS[vertical].toLowerCase()}.` };
  if (agent.onboarding_completed_at) return { ok: false, error: `${agent.full_name}'s campaign already started as a ${VERTICAL_LABELS[(isVertical(agent.vertical) ? agent.vertical : "insurance") as Vertical].toLowerCase()}. Its ads, pages and Meta category were built for that, so it can't switch.` };
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ vertical, vertical_chosen_at: new Date().toISOString(), ...startingColumns(vertical) })
    .eq("id", agentId);
  if (error) return { ok: false, error: error.code === "23514" ? "The database doesn't know that business type yet (migration 20261220000000_invites.sql)." : "Couldn't save that." };
  return { ok: true, message: `${agent.full_name} is now a ${VERTICAL_LABELS[vertical].toLowerCase()}.` };
}
