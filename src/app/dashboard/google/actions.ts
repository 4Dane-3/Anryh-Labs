"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { alertAdmin } from "@/lib/migz/slack";
import { googleAdsReady, GoogleAdsError } from "@/lib/google-ads/api";
import { createClientAccount, getGoogleAccount, refreshLink, saveGoogleAccount, sendLinkRequest } from "@/lib/google-ads/account";
import { customerIdFrom, formatCustomerId } from "@/lib/google-ads/ids";
import { GOOGLE_MAX_MONTHLY_CENTS, GOOGLE_MIN_MONTHLY_CENTS } from "@/lib/google-ads/playbook";
import { checkAction, type GAction } from "@/lib/google-ads/guardrails";
import { applyChecked, guardCtxFor, runGoogleAds } from "@/lib/google-ads/review";
import type { GoogleSnapshot } from "@/lib/google-ads/types";

type Result = { ok: true; message: string; status?: string } | { ok: false; error: string };

const MIGRATION = "Google Ads isn't switched on yet: run migration 20261214000000_google_ads.sql.";
const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /google_ads_accounts/.test(e.message ?? ""));
const errText = (e: unknown) => (e instanceof GoogleAdsError ? e.message : e instanceof Error ? e.message : String(e));

function capFrom(dollars: number) {
  const cents = Math.round(dollars * 100);
  if (!Number.isFinite(cents) || cents < GOOGLE_MIN_MONTHLY_CENTS || cents > GOOGLE_MAX_MONTHLY_CENTS) return null;
  return cents;
}

function refresh() {
  revalidatePath("/dashboard/start");
  revalidatePath("/dashboard/google");
}

/** They have a Google Ads account: save it and send our manager account's link request. */
export async function connectGoogleAds(input: { customerId: string; monthlyDollars: number }): Promise<Result> {
  const agent = await requireAgent();
  const customerId = customerIdFrom(input.customerId);
  if (!customerId) return { ok: false, error: "Enter your 10-digit Google Ads customer ID (top right in Google Ads, like 123-456-7890)." };
  const cap = capFrom(input.monthlyDollars);
  if (!cap) return { ok: false, error: `Choose a monthly Google budget of at least $${GOOGLE_MIN_MONTHLY_CENTS / 100}.` };
  const existing = await getGoogleAccount(agent.id);
  const same = existing?.customer_id === customerId && existing.link_status !== "refused" && existing.link_status !== "ended";
  const { error } = await saveGoogleAccount(agent.id, { customer_id: customerId, monthly_cap_cents: cap, ...(same ? {} : { link_status: "pending", link_resource: null, campaign_id: null, budget_resource: null, conversion_actions: {}, launched_at: null }) });
  if (error) return { ok: false, error: missingTable(error) ? MIGRATION : "Couldn't save that. Try again." };
  if (same && (existing!.link_status === "linked" || existing!.link_status === "created")) {
    refresh();
    return { ok: true, status: existing!.link_status, message: "Saved. Migz manages this account." };
  }
  if (!googleAdsReady()) {
    await alertAdmin(`${agent.full_name} (${agent.slug}) wants Google Ads on account ${formatCustomerId(customerId)}: send the manager link request (API not configured yet).`);
    refresh();
    return { ok: true, status: "pending", message: "Saved. We'll send a request to manage it from Anryh Labs: accept it in Google Ads under Admin → Access and security → Managers." };
  }
  try {
    const resource = await sendLinkRequest(customerId);
    await saveGoogleAccount(agent.id, { link_resource: resource });
  } catch (e) {
    const msg = errText(e);
    if (!/ALREADY|already/i.test(msg)) return { ok: false, error: `Google said: ${msg}. Check the ID and that it's a regular Google Ads account (not a manager account).` };
  }
  const { account } = await refreshLink(agent.id);
  refresh();
  return account?.link_status === "linked"
    ? { ok: true, status: "linked", message: "Linked. Migz will build your Google campaign once your campaign starts." }
    : { ok: true, status: "pending", message: "Request sent. In Google Ads, open Admin → Access and security → Managers and accept Anryh Labs' request, then press Check again." };
}

/** They don't have one: we make it under our manager account and invite them as its admin. */
export async function createGoogleAdsAccount(input: { email: string; monthlyDollars: number }): Promise<Result> {
  const agent = await requireAgent();
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter the Google email that should own the account (a Gmail or Google Workspace address)." };
  const cap = capFrom(input.monthlyDollars);
  if (!cap) return { ok: false, error: `Choose a monthly Google budget of at least $${GOOGLE_MIN_MONTHLY_CENTS / 100}.` };
  if (!googleAdsReady()) {
    await alertAdmin(`${agent.full_name} (${agent.slug}) needs a new Google Ads account, owned by ${email}, $${cap / 100}/month (API not configured yet).`);
    return { ok: true, status: "requested", message: "Got it. We'll create your Google Ads account and email an invitation to that address to make you its admin." };
  }
  try {
    const made = await createClientAccount({ name: agent.full_name || agent.slug, email, timeZone: agent.timezone || "America/Los_Angeles" });
    if (!made.customerId) return { ok: false, error: "Google didn't return the new account. Try again in a minute." };
    const { error } = await saveGoogleAccount(agent.id, { customer_id: made.customerId, link_status: "created", invite_email: email, monthly_cap_cents: cap, campaign_id: null, budget_resource: null, conversion_actions: {} });
    if (error) return { ok: false, error: missingTable(error) ? MIGRATION : "Couldn't save the new account." };
    refresh();
    return { ok: true, status: "created", message: `Made account ${formatCustomerId(made.customerId)}. Google emailed ${email} an invitation: accept it, then add your card under Billing in Google Ads so the ads can run.` };
  } catch (e) {
    return { ok: false, error: `Google said: ${errText(e)}` };
  }
}

export async function checkGoogleAds(): Promise<Result> {
  const agent = await requireAgent();
  const { account } = await refreshLink(agent.id);
  refresh();
  if (!account) return { ok: false, error: "Connect a Google Ads account first." };
  if (account.link_status === "linked" || account.link_status === "created") return { ok: true, status: account.link_status, message: "Linked: Migz manages this account." };
  if (account.link_status === "refused") return { ok: false, error: "The request was declined in Google Ads. Save the ID again to send a new one." };
  return { ok: true, status: account.link_status, message: "Not accepted yet. In Google Ads: Admin → Access and security → Managers → accept Anryh Labs." };
}

export async function saveGoogleSettings(input: { monthlyDollars: number; enabled: boolean; avgJobDollars: number | null }): Promise<Result> {
  const agent = await requireAgent();
  const cap = capFrom(input.monthlyDollars);
  if (!cap) return { ok: false, error: `The monthly Google budget is at least $${GOOGLE_MIN_MONTHLY_CENTS / 100}.` };
  const avg = input.avgJobDollars == null ? null : Math.round(input.avgJobDollars);
  if (avg !== null && (avg < 100 || avg > 1_000_000)) return { ok: false, error: "Average job: between $100 and $1,000,000." };
  const { error } = await saveGoogleAccount(agent.id, { monthly_cap_cents: cap, enabled: !!input.enabled });
  if (error) return { ok: false, error: missingTable(error) ? MIGRATION : "Couldn't save that." };
  await supabaseAdmin.from("agents").update({ avg_job_dollars: avg }).eq("id", agent.id);
  // The cap and the on/off switch apply on the next run; run it now so it's immediate
  after(() => runGoogleAds({ ...agent, avg_job_dollars: avg }).then(() => undefined, () => undefined));
  refresh();
  return { ok: true, message: "Saved." };
}

/** Approves a change Migz proposed: it's checked again against today's numbers, then made. */
export async function decideGoogleAction(id: string, approve: boolean): Promise<Result> {
  const agent = await requireAgent();
  const { data: claimed } = await supabaseAdmin
    .from("google_ads_actions")
    .update({ status: approve ? "applying" : "rejected", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("agent_id", agent.id)
    .eq("status", "proposed")
    .select("tool, payload, title, reason")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "That change was already decided or has expired." };
  refresh();
  if (!approve) return { ok: true, message: "Declined." };
  const account = await getGoogleAccount(agent.id);
  const snapshot = account?.snapshot as GoogleSnapshot | null;
  const action = claimed.payload as GAction;
  const why = account && snapshot ? checkAction(action, guardCtxFor(account, snapshot)) : "The account isn't synced yet.";
  if (why) {
    await supabaseAdmin.from("google_ads_actions").update({ status: "expired", result: { error: why } }).eq("id", id);
    return { ok: false, error: `Not made: the numbers changed. ${why}` };
  }
  const r = await applyChecked(agent, account!, action, claimed.title, claimed.reason ?? "");
  await supabaseAdmin.from("google_ads_actions").update({ status: r.ok ? "applied" : "failed", result: r }).eq("id", id);
  return r.ok ? { ok: true, message: "Done." } : { ok: false, error: `Google rejected it: ${r.error}` };
}
