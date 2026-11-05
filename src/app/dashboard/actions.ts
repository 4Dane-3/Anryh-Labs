"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAnryhAdmin, requireAgent } from "@/lib/auth";
import { usPhone } from "@/lib/booking/call";
import { cleanCarriers } from "@/lib/carriers";
import { integrations, migzReadyFor } from "@/lib/integrations";
import { batchPacing, buildEvalContext, pauseAdSetsNow, retargetNow, runMigz, syncLeadStyle } from "@/lib/migz/agent";
import { applyPayload } from "@/lib/migz/executor";
import { buildSnapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
import { defaultCreateMessage, monthlyBudget } from "@/lib/migz/router";
import { traitSwipe } from "@/lib/migz/team/scout";
import type { TopicKey } from "@/lib/migz/topics";
import { PAGE_FONT_KEYS } from "@/lib/booking/page-font-keys";
import { MAX_DEPOSIT_CENTS, MIN_TOP_UP_CENTS, minDepositFor } from "@/lib/campaign";
import { CONTACT_EMAIL } from "@/lib/contact";
import { dailyBatch } from "@/lib/batch";
import { closeEndedBatch, getActiveBatch, getBatchHistory, getOpenBatch } from "@/lib/dashboard/batches";
import { buildCampaignPlan } from "@/lib/dashboard/campaign-plan";
import { isClientStatus, startsFollowUps, type OutcomeKind } from "@/lib/outcomes";
import { isAgentActivityKind, type Subject } from "@/lib/dashboard/activity";
import {
  addClientActivity,
  addPersonalClient,
  clientTap,
  deleteClientActivity,
  getClientActivity,
  saveClientNotes,
  couldntReach,
  sentAnEmail,
  setClientStatus,
  triedToCall,
  updateClientActivity,
  type ClientActivity,
} from "@/lib/dashboard/clients";
import { cleanSequence, SEQUENCES, sequencesFor, type Sequence } from "@/lib/email-sequences";
import { campaignMoney, cleanAnswers, MAX_CAMPAIGN_DAILY_CENTS, MIN_CAMPAIGN_DAILY_CENTS, type CampaignAnswers, type CampaignPlan } from "@/lib/campaign-plan";
import { activateBatch } from "@/lib/dashboard/start-batch";
import { getBalanceCents, getFundsAddedCents } from "@/lib/dashboard/queries";
import { checkoutReturnBase, createAutoTopUpSetup, createDepositCheckout, createSetupFeeCheckout, stripe } from "@/lib/stripe";
import { cleanTopUp, topUpConsent } from "@/lib/auto-top-up";
import { startGuarantee } from "@/lib/dashboard/guarantee";
import { setupBlockers } from "@/lib/dashboard/setup";
import { adAccountFrom, checkMetaAccess, pageRefFrom } from "@/lib/meta/access";
import { alertAdmin } from "@/lib/migz/slack";
import { sendSlackMessage } from "@/lib/slack";
import { isRoofer, MAX_RADIUS_MILES, MIN_RADIUS_MILES } from "@/lib/verticals";
import { ROOFING_TOPIC_KEYS } from "@/lib/migz/topics";
import { crmPayload, validWebhookUrl } from "@/lib/roofing/notify";
import { radiusCenter } from "@/lib/meta/ads";
import { STATE_CODES } from "@/lib/campaign-plan";
import type { Agent } from "@/lib/booking/data";
import { recheck, type ActionPayload } from "@/lib/migz/tools";
import { STEP_TITLES, type IntakeQuestion, type QuestionKind } from "@/lib/booking/questions";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier, VIDEO_TIERS, type IntentLevel, type VideoTier } from "@/lib/ad-options";

// Every action re-resolves the signed-in agent and scopes writes to agent.id,
// so a client can never touch another agent's rows by passing someone else's ids.

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---------- Clients & bookings ----------

export async function saveBookingNotes(bookingId: string, notes: string): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin
    .from("bookings")
    .update({ agent_notes: clean(notes, 5000) || null })
    .eq("id", bookingId)
    .eq("agent_id", agent.id);
  if (error) return fail("Couldn't save your notes.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function cancelBooking(bookingId: string): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("agent_id", agent.id);
  if (error) return fail("Couldn't cancel this call.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- Working hours ----------

type HoursInput = {
  rules: { weekday: number; start_time: string; end_time: string }[];
  slot_minutes: number;
  slot_interval_minutes?: number; // 0 = same as the call length
  buffer_minutes: number;
  min_notice_hours: number;
  max_days_ahead: number;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveWorkingHours(input: HoursInput): Promise<Result> {
  const agent = await requireAgent();

  const rules = (input.rules ?? []).slice(0, 50);
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) return fail("Invalid day.");
    if (!TIME_RE.test(r.start_time) || !TIME_RE.test(r.end_time)) return fail("Times must look like 09:00.");
    if (r.end_time <= r.start_time) return fail("Each time range has to end after it starts.");
  }
  const within = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!within(input.slot_minutes, 10, 120)) return fail("Call length must be 10–120 minutes.");
  const interval = input.slot_interval_minutes ?? 0;
  if (interval !== 0 && !within(interval, 10, 240)) return fail("Start times must be 10–240 minutes apart.");
  if (!within(input.buffer_minutes, 0, 120)) return fail("Buffer must be 0–120 minutes.");
  if (!within(input.min_notice_hours, 0, 168)) return fail("Notice must be 0–168 hours.");
  if (!within(input.max_days_ahead, 1, 90)) return fail("Booking window must be 1–90 days.");

  const settings = {
    slot_minutes: input.slot_minutes,
    buffer_minutes: input.buffer_minutes,
    min_notice_hours: input.min_notice_hours,
    max_days_ahead: input.max_days_ahead,
  };
  let { error: settingsError } = await supabaseAdmin
    .from("agents")
    .update({ ...settings, slot_interval_minutes: interval || null })
    .eq("id", agent.id);
  // Before the slot_interval migration: save the rest, and only complain if a spacing was chosen
  if (settingsError && (settingsError.code === "PGRST204" || settingsError.code === "42703")) {
    if (interval) return fail("Start-time spacing isn't set up yet. Choose \"Same as call length\" for now.");
    ({ error: settingsError } = await supabaseAdmin.from("agents").update(settings).eq("id", agent.id));
  }
  if (settingsError) return fail("Couldn't save your booking settings.");

  const { error: deleteError } = await supabaseAdmin
    .from("availability_rules")
    .delete()
    .eq("agent_id", agent.id);
  if (deleteError) return fail("Couldn't update your hours.");

  if (rules.length) {
    const { error } = await supabaseAdmin
      .from("availability_rules")
      .insert(rules.map((r) => ({ ...r, agent_id: agent.id })));
    if (error) return fail("Couldn't update your hours.");
  }

  revalidatePath("/dashboard/calendar");
  return { ok: true };
}

// ---------- Ad funds ----------

export async function setAdsPaused(paused: boolean): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ ads_paused: paused })
    .eq("id", agent.id);
  if (error) return fail("Couldn't update your ads.");
  // Pausing stops delivery in Meta now, not at the next review (hours later, and never with Migz off).
  // Turning ads back on is left to the next review, which checks the balance and batch dates first.
  if (paused && migzReadyFor(agent)) {
    try {
      await pauseAdSetsNow(agent, {
        summary: "Pausing your ad sets",
        title: "Paused your ads",
        detail: "You turned ads off. They'll stay paused until you turn them back on.",
      });
    } catch (e) {
      console.error("pausing in Meta failed", e);
      revalidatePath("/dashboard", "layout");
      return fail("Ads are marked paused, but Meta didn't confirm it. Pause them in Ads Manager to be sure, then try again.");
    }
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Starts a Stripe Checkout session for an ad-funds deposit. Needs Stripe keys. */
export async function startDeposit(cents: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const agent = await requireAgent();
  // The first deposit starts a campaign, so it covers two weeks; later top-ups can be smaller
  const minCents = minDepositFor(await getFundsAddedCents(agent.id));
  if (!Number.isInteger(cents) || cents < minCents || cents > MAX_DEPOSIT_CENTS)
    return { ok: false, error: `${minCents > MIN_TOP_UP_CENTS ? "Your first deposit starts your campaign with two weeks of ads, so it" : "A deposit"} must be between $${(minCents / 100).toLocaleString("en-US")} and $${(MAX_DEPOSIT_CENTS / 100).toLocaleString("en-US")}.` };
  // Agents who finished setup before the setup fee existed count as paid
  if (!agent.setup_fee_paid_at && !agent.onboarding_completed_at) return { ok: false, error: "Pay the setup fee first: it's step 1 in Start here." };
  if (!integrations.stripe)
    return { ok: false, error: "Payments aren't connected yet, so funds can't be added. This will work once Stripe is set up." };
  try {
    const addedBeforeCents = await getFundsAddedCents(agent.id);
    const url = await createDepositCheckout({
      agentId: agent.id,
      email: agent.email,
      cents,
      addedBeforeCents,
      returnTo: agent.onboarding_completed_at ? "funds" : "start",
      appUrl: checkoutReturnBase(),
      customerId: agent.stripe_customer_id ?? null,
    });
    return { ok: true, url };
  } catch (e) {
    console.error("stripe checkout failed", e);
    return { ok: false, error: "Couldn't open the payment page. Please try again." };
  }
}

// ---------- Auto top-up ----------

const topUpColumnsMissing = (code?: string) => code === "42703" || code === "PGRST204";

/** Opens Stripe to save a card for auto top-up (nothing is charged), with the amount and level the agent chose. */
export async function startAutoTopUpSetup(input: { amountCents: number; belowCents: number; agreed: boolean }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const agent = await requireAgent();
  const t = cleanTopUp(input);
  if (typeof t === "string") return { ok: false, error: t };
  if (!input.agreed) return { ok: false, error: "Tick the box to authorize the automatic charges first." };
  if (!agent.setup_fee_paid_at && !agent.onboarding_completed_at) return { ok: false, error: "Pay the setup fee first: it's in Start here." };
  if (!integrations.stripe) return { ok: false, error: "Payments aren't connected yet. This will work once Stripe is set up." };
  try {
    const url = await createAutoTopUpSetup({
      agentId: agent.id,
      email: agent.email,
      appUrl: checkoutReturnBase(),
      customerId: agent.stripe_customer_id ?? null,
      ...t,
      consent: topUpConsent(t.amountCents, t.belowCents),
    });
    return { ok: true, url };
  } catch (e) {
    console.error("stripe auto top-up setup failed", e);
    return { ok: false, error: "Couldn't open the card page. Please try again." };
  }
}

/** Changes the amount and level of an auto top-up that already has a card. */
export async function saveAutoTopUp(input: { amountCents: number; belowCents: number }): Promise<Result> {
  const agent = await requireAgent();
  const t = cleanTopUp(input);
  if (typeof t === "string") return fail(t);
  if (!agent.stripe_payment_method_id) return fail("Save a card first.");
  const { error } = await supabaseAdmin.from("agents").update({ auto_topup_amount_cents: t.amountCents, auto_topup_below_cents: t.belowCents }).eq("id", agent.id);
  if (error) return fail(topUpColumnsMissing(error.code) ? "Auto top-up isn't switched on yet. Please try again shortly." : "Couldn't save that.");
  revalidatePath("/dashboard/funds");
  return { ok: true };
}

/** Turns auto top-up off (the card stays saved), or back on with the saved card. */
export async function setAutoTopUp(on: boolean): Promise<Result> {
  const agent = await requireAgent();
  if (on && !agent.stripe_payment_method_id) return fail("Save a card first.");
  if (on && agent.auto_topup_error) return fail("The last top-up failed. Save a card again to turn it back on.");
  const { error } = await supabaseAdmin.from("agents").update({ auto_topup: !!on }).eq("id", agent.id);
  if (error) return fail(topUpColumnsMissing(error.code) ? "Auto top-up isn't switched on yet. Please try again shortly." : "Couldn't save that.");
  revalidatePath("/dashboard/funds");
  return { ok: true };
}

/** Removes the saved card from Stripe and turns auto top-up off. */
export async function removeAutoTopUpCard(): Promise<Result> {
  const agent = await requireAgent();
  if (agent.stripe_payment_method_id && integrations.stripe) {
    await stripe().paymentMethods.detach(agent.stripe_payment_method_id).catch((e) => console.error("detaching the card failed", e instanceof Error ? e.message : e));
  }
  const { error } = await supabaseAdmin.from("agents").update({ auto_topup: false, stripe_payment_method_id: null, auto_topup_card: null, auto_topup_error: null }).eq("id", agent.id);
  if (error) return fail("Couldn't remove the card.");
  revalidatePath("/dashboard/funds");
  return { ok: true };
}

/** Starts a Stripe Checkout session for the one-time setup fee (step 1 of Start here). */
export async function startSetupFee(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const agent = await requireAgent();
  if (agent.setup_fee_paid_at || agent.onboarding_completed_at) return { ok: false, error: "Your setup fee is already paid." };
  if (!integrations.stripe)
    return { ok: false, error: `Payments aren't connected yet. Email ${CONTACT_EMAIL} and we'll take the setup fee another way.` };
  try {
    const url = await createSetupFeeCheckout({ agentId: agent.id, email: agent.email, appUrl: checkoutReturnBase(), customerId: agent.stripe_customer_id ?? null });
    return { ok: true, url };
  } catch (e) {
    console.error("stripe setup fee checkout failed", e);
    return { ok: false, error: "Couldn't open the payment page. Please try again." };
  }
}

// ---------- Start here: business details, Meta access, booking page, Slack ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const missingColumn = (code?: string) => code === "42703" || code === "PGRST204";

export async function saveBusinessInfo(input: { agency_name: string; npn: string; business_email: string; phone: string }): Promise<Result> {
  const agent = await requireAgent();
  const agency = clean(input.agency_name, 120);
  if (agency.length < 2 && !isRoofer(agent)) return fail("Add the agency or IMO you write through.");
  const npn = clean(input.npn, 20).replace(/\D/g, "");
  if (input.npn.trim() && (npn.length < 4 || npn.length > 10)) return fail("NPNs are 4 to 10 digits. Leave it blank if you'd rather not add it.");
  const email = clean(input.business_email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return fail("Enter the email leads' replies should go to.");
  const phone = usPhone(input.phone);
  if (!phone) return fail("Enter a 10-digit US phone number.");
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ agency_name: agency || null, npn: npn || null, business_email: email === agent.email.toLowerCase() ? null : email, call_phone: phone })
    .eq("id", agent.id);
  if (error) return fail(missingColumn(error.code) ? "This step isn't switched on yet. Please try again shortly." : "Couldn't save that.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/**
 * Saves the ad account and Page the agent shared, then links them if Anryh Labs can already reach both.
 * Until then staff hear about it once, to accept the partner request.
 */
export async function saveMetaAccess(input: { adAccount: string; page: string }): Promise<{ ok: true; linked: boolean; message: string } | { ok: false; error: string }> {
  const agent = await requireAgent();
  if (agent.onboarding_completed_at && agent.meta_ad_account_id)
    return { ok: false, error: `Your ad account is already linked. To change it, email ${CONTACT_EMAIL}.` };
  const account = adAccountFrom(input.adAccount);
  if (!account) return { ok: false, error: "Ad account IDs are numbers, like 1234567890 (Ads Manager shows it next to the account name)." };
  const pageRef = pageRefFrom(input.page);
  if (!pageRef) return { ok: false, error: "Paste your Page's link (facebook.com/yourpage) or its Page ID." };

  const first = !agent.meta_access_requested_at || agent.meta_ad_account_requested !== account || agent.meta_page_requested !== pageRef;
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ meta_ad_account_requested: account, meta_page_requested: pageRef, ...(first ? { meta_access_requested_at: new Date().toISOString() } : {}) })
    .eq("id", agent.id);
  if (error) return { ok: false, error: missingColumn(error.code) ? "This step isn't switched on yet. Please try again shortly." : "Couldn't save that." };

  const access = integrations.meta ? await checkMetaAccess(account, pageRef) : { adAccount: null, page: null };
  if (access.adAccount && access.page) {
    const { error: linkError } = await supabaseAdmin
      .from("agents")
      .update({ meta_ad_account_id: access.adAccount.id, meta_page_id: access.page.id, meta_instagram_id: access.page.instagramId ?? agent.meta_instagram_id })
      .eq("id", agent.id);
    if (linkError) return { ok: false, error: "Couldn't link your ad account. Please try again." };
    revalidatePath("/dashboard", "layout");
    return { ok: true, linked: true, message: `Linked: ${access.adAccount.name} and ${access.page.name}.` };
  }

  if (first)
    after(() =>
      alertAdmin(
        `${agent.full_name} (${agent.slug}) shared Meta access for setup. Accept the partner request in Business Settings and assign both to the Migz system user: ad account ${account}${access.adAccount ? " (already reachable)" : ""}, Page ${pageRef}${access.page ? " (already reachable)" : ""}.`,
      ),
    );
  revalidatePath("/dashboard", "layout");
  const waiting = [!access.adAccount && "ad account", !access.page && "Page"].filter(Boolean).join(" and ");
  return { ok: true, linked: false, message: `Saved. We can't reach your ${waiting} yet: once we accept your partner request (usually within a business day), press Check again.` };
}

export async function setBookingChoice(input: { choice: "ours" | "own"; url: string }): Promise<Result> {
  const agent = await requireAgent();
  if (input.choice !== "ours" && input.choice !== "own") return fail("Pick one.");
  let url: string | null = null;
  if (input.choice === "own") {
    try {
      const u = new URL(clean(input.url, 500));
      if (u.protocol !== "https:") throw new Error();
      url = u.toString();
    } catch {
      return fail("Paste the full link to your booking page, starting with https://");
    }
  }
  const { error } = await supabaseAdmin.from("agents").update({ booking_choice: input.choice, own_booking_url: url }).eq("id", agent.id);
  if (error) return fail(missingColumn(error.code) ? "This step isn't switched on yet. Please try again shortly." : "Couldn't save that.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Start here's last step: whether Migz runs the ads on its own or asks first. Changeable later in Settings. */
export async function chooseMigzMode(mode: "auto" | "approve"): Promise<Result> {
  const agent = await requireAgent();
  if (mode !== "auto" && mode !== "approve") return fail("Pick one.");
  const { error } = await supabaseAdmin.from("agents").update({ migz_mode: mode, migz_mode_chosen_at: new Date().toISOString() }).eq("id", agent.id);
  if (error) return fail(missingColumn(error.code) ? "This step isn't switched on yet. Please try again shortly." : "Couldn't save that.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Saves their Slack member ID only once a test message reaches them, so a wrong ID never sticks. */
export async function connectSlack(memberId: string): Promise<Result> {
  const agent = await requireAgent();
  const id = clean(memberId, 20).toUpperCase();
  if (!/^[UW][A-Z0-9]{6,}$/.test(id)) return fail("Slack member IDs start with U and look like U04ABCD123.");
  if (!integrations.slack) return fail(`Slack isn't connected on our side yet. Email ${CONTACT_EMAIL} and we'll sort it out.`);
  try {
    await sendSlackMessage(id, `:wave: Hi ${agent.full_name.split(" ")[0]}, this is Migz. You're connected: new leads, bookings and your morning summary will show up here.`);
  } catch {
    return fail("We couldn't message that ID. Make sure you've joined the Anryh Labs Slack and copied your own member ID.");
  }
  const { error } = await supabaseAdmin.from("agents").update({ slack_user_id: id }).eq("id", agent.id);
  if (error) return fail("Couldn't save that.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- Uploads (creatives + profile photo) ----------

const CREATIVE_TYPES: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

function safeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+/g, "-").slice(-80);
}

/** Returns a one-time signed URL; the browser uploads straight to Storage (videos never pass through us). */
export async function createCreativeUpload(file: { name: string; type: string; size: number }) {
  const agent = await requireAgent();
  if (!CREATIVE_TYPES[file.type]) return { ok: false as const, error: "Use a JPG, PNG, WebP, MP4, MOV or WebM file." };
  if (file.size > 500 * 1024 * 1024) return { ok: false as const, error: "Files must be under 500 MB." };

  const path = `${agent.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { data, error } = await supabaseAdmin.storage.from("creatives").createSignedUploadUrl(path);
  if (error || !data) return { ok: false as const, error: "Couldn't start the upload." };
  return { ok: true as const, path, signedUrl: data.signedUrl };
}

export async function confirmCreativeUpload(file: { path: string; name: string; type: string; size: number }): Promise<Result> {
  const agent = await requireAgent();
  const kind = CREATIVE_TYPES[file.type];
  if (!kind || !file.path.startsWith(`${agent.id}/`)) return fail("Invalid upload.");

  const { error } = await supabaseAdmin.from("creatives").insert({
    agent_id: agent.id,
    kind,
    storage_path: file.path,
    file_name: clean(file.name, 200) || "Untitled",
    mime_type: file.type,
    size_bytes: Math.max(0, Math.floor(file.size)),
  });
  if (error) return fail("Uploaded, but couldn't save it. Try again.");
  revalidatePath("/dashboard/creatives");
  return { ok: true };
}

export async function deleteCreative(id: string): Promise<Result> {
  const agent = await requireAgent();
  const { data } = await supabaseAdmin
    .from("creatives")
    .delete()
    .eq("id", id)
    .eq("agent_id", agent.id)
    .select("storage_path")
    .maybeSingle();
  if (!data) return fail("Couldn't delete that file.");
  await supabaseAdmin.storage.from("creatives").remove([data.storage_path]);
  revalidatePath("/dashboard/creatives");
  return { ok: true };
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function createPhotoUpload(file: { name: string; type: string; size: number }) {
  const agent = await requireAgent();
  if (!PHOTO_TYPES.includes(file.type)) return { ok: false as const, error: "Use a JPG, PNG or WebP image." };
  if (file.size > 10 * 1024 * 1024) return { ok: false as const, error: "Photos must be under 10 MB." };
  const path = `${agent.id}/photo-${Date.now()}-${safeName(file.name)}`;
  const { data, error } = await supabaseAdmin.storage.from("agent-media").createSignedUploadUrl(path);
  if (error || !data) return { ok: false as const, error: "Couldn't start the upload." };
  return { ok: true as const, path, signedUrl: data.signedUrl };
}

export async function setProfilePhoto(path: string | null): Promise<Result> {
  const agent = await requireAgent();
  if (path && !path.startsWith(`${agent.id}/`)) return fail("Invalid photo.");
  const url = path ? supabaseAdmin.storage.from("agent-media").getPublicUrl(path).data.publicUrl : null;
  const { error } = await supabaseAdmin.from("agents").update({ photo_url: url }).eq("id", agent.id);
  if (error) return fail("Couldn't save your photo.");

  // Delete the photo this replaced, if it was one we stored (not an external URL)
  const marker = `/agent-media/${agent.id}/`;
  const oldPath = agent.photo_url?.includes(marker) ? agent.photo_url.split("/agent-media/")[1] : null;
  if (oldPath && oldPath !== path) await supabaseAdmin.storage.from("agent-media").remove([oldPath]);
  revalidatePath("/dashboard", "layout");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

// ---------- Landing page profile ----------

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

export async function updateProfile(input: {
  full_name: string;
  title?: string;
  headline: string;
  bio: string;
  license_number: string;
  licensed_states: string[];
  partner_carriers?: string[];
}): Promise<Result> {
  const agent = await requireAgent();
  const full_name = clean(input.full_name, 80);
  if (full_name.length < 2) return fail("Add your name.");
  const states = [...new Set((input.licensed_states ?? []).map((s) => clean(s, 2).toUpperCase()))].filter((s) =>
    US_STATES.has(s),
  );

  const { error } = await supabaseAdmin
    .from("agents")
    .update({
      full_name,
      ...(input.title !== undefined ? { title: clean(input.title, 80) || null } : {}),
      headline: clean(input.headline, 140) || null,
      bio: clean(input.bio, 1200) || null,
      license_number: clean(input.license_number, 40) || null,
      licensed_states: states,
      // Only once its migration has run (the column is missing from the row until then)
      ...(input.partner_carriers !== undefined && agent.partner_carriers !== undefined ? { partner_carriers: cleanCarriers(input.partner_carriers) } : {}),
    })
    .eq("id", agent.id);
  if (error) return fail("Couldn't save your page.");

  // New licensed states take effect in Meta now, not at the next review
  const changed = [...states].sort().join() !== [...agent.licensed_states].sort().join();
  if (changed && migzReadyFor(agent)) {
    const fresh = { ...agent, licensed_states: states };
    after(async () => {
      await retargetNow(fresh).catch((e) => console.error("re-targeting failed", e));
    });
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

// ---------- Testimonials ----------

export async function saveTestimonial(input: {
  id?: string;
  author_name: string;
  author_detail: string;
  quote: string;
  rating: number | null;
  published: boolean;
  permission_confirmed: boolean;
}): Promise<Result> {
  const agent = await requireAgent();
  const author_name = clean(input.author_name, 80);
  const quote = clean(input.quote, 600);
  if (!author_name) return fail("Add the client's name (first name and last initial is fine).");
  if (quote.length < 10) return fail("The testimonial needs at least a sentence.");
  if (!input.permission_confirmed) return fail("Confirm the client gave permission to share this.");
  // Whole or half stars, 0.5 to 5
  const rating = typeof input.rating === "number" && Number.isFinite(input.rating) && input.rating >= 0.5 && input.rating <= 5 ? Math.round(input.rating * 2) / 2 : null;

  const row = {
    author_name,
    author_detail: clean(input.author_detail, 80) || null,
    quote,
    rating,
    published: !!input.published,
    permission_confirmed: true,
  };

  const { error } = input.id
    ? await supabaseAdmin.from("testimonials").update(row).eq("id", input.id).eq("agent_id", agent.id)
    : await supabaseAdmin.from("testimonials").insert({ ...row, agent_id: agent.id, sort: Date.now() % 1_000_000_000 });
  // Before the half-star migration the column only takes whole numbers
  if (error && rating !== null && !Number.isInteger(rating)) return fail("Half stars aren't set up yet. Pick a whole star for now.");
  if (error) return fail("Couldn't save the testimonial.");
  revalidatePath("/dashboard/landing");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

export async function deleteTestimonial(id: string): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin.from("testimonials").delete().eq("id", id).eq("agent_id", agent.id);
  if (error) return fail("Couldn't delete the testimonial.");
  revalidatePath("/dashboard/landing");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

// ---------- Intake questions ----------

const KINDS: QuestionKind[] = ["short_text", "long_text", "choice", "date"];

export async function saveQuestions(questions: IntakeQuestion[], requiredSteps: number[] = []): Promise<Result> {
  const agent = await requireAgent();
  if (!Array.isArray(questions) || questions.length > 40) return fail("You can have up to 40 questions.");
  const steps = Array.isArray(requiredSteps)
    ? [...new Set(requiredSteps.filter((s) => Number.isInteger(s) && s >= 1 && s <= 4))].sort()
    : [];

  const keys = new Set<string>();
  const rows = [];
  for (const [i, q] of questions.entries()) {
    const key = clean(q.key, 40);
    const label = clean(q.label, 200);
    if (!/^[a-z0-9_]{1,40}$/.test(key) || keys.has(key)) return fail("Two questions ended up with the same id. Refresh and try again.");
    if (!label)
      return fail(`A question in "${STEP_TITLES[q.step - 1] ?? "your form"}" is blank. Write the question or delete it.`);
    if (!KINDS.includes(q.kind)) return fail("Unknown answer type.");
    if (!Number.isInteger(q.step) || q.step < 1 || q.step > 4) return fail("Each question needs a step 1–4.");
    const options = q.kind === "choice" ? [...new Set((q.options ?? []).map((o) => clean(o, 80)).filter(Boolean))].slice(0, 12) : [];
    if (q.kind === "choice" && options.length < 2) return fail(`"${label}" needs at least two choices.`);
    keys.add(key);
    rows.push({
      agent_id: agent.id,
      key,
      label,
      kind: q.kind,
      step: q.step,
      sort: i,
      options,
      allow_other: q.kind === "choice" && !!q.allow_other,
      placeholder: q.kind === "short_text" || q.kind === "long_text" ? clean(q.placeholder, 120) || null : null,
      hidden_when_key: q.hidden_when_key || null,
      hidden_when_value: q.hidden_when_key ? clean(q.hidden_when_value, 80) || null : null,
      enabled: q.enabled !== false,
      required: q.required === true,
    });
  }

  // A condition must point at a multiple-choice question that still exists, using one of its choices
  for (const row of rows) {
    if (!row.hidden_when_key) continue;
    const target = rows.find((r) => r.key === row.hidden_when_key);
    if (!target || target.kind !== "choice" || !target.options.includes(row.hidden_when_value ?? "")) {
      row.hidden_when_key = null;
      row.hidden_when_value = null;
    }
  }

  const { error } = await supabaseAdmin.from("intake_questions").upsert(rows, { onConflict: "agent_id,key" });
  if (error) return fail("Couldn't save your questions. If this keeps happening, the required-questions migration may not have run yet.");
  const { error: stepsError } = await supabaseAdmin.from("agents").update({ required_intake_steps: steps }).eq("id", agent.id);
  if (stepsError) return fail("Couldn't save your required steps.");

  const { data: existing } = await supabaseAdmin.from("intake_questions").select("key").eq("agent_id", agent.id);
  const removed = (existing ?? []).map((r) => r.key).filter((k) => !keys.has(k));
  if (removed.length) {
    await supabaseAdmin.from("intake_questions").delete().eq("agent_id", agent.id).in("key", removed);
  }

  revalidatePath("/dashboard/questions");
  return { ok: true };
}

export async function resetQuestions(): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin.from("intake_questions").delete().eq("agent_id", agent.id);
  if (error) return fail("Couldn't reset your questions.");
  await supabaseAdmin.from("agents").update({ required_intake_steps: [] }).eq("id", agent.id);
  revalidatePath("/dashboard/questions");
  return { ok: true };
}

// ---------- Settings ----------

export async function updateSettings(input: {
  slack_user_id: string;
  timezone: string;
  digest_hour: number;
}): Promise<Result> {
  const agent = await requireAgent();
  const slack = clean(input.slack_user_id, 20).toUpperCase();
  if (slack && !/^[UW][A-Z0-9]{6,}$/.test(slack)) return fail("Slack member IDs start with U and look like U04ABCD123.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    return fail("Pick a valid timezone.");
  }
  if (!Number.isInteger(input.digest_hour) || input.digest_hour < 0 || input.digest_hour > 23)
    return fail("Pick an hour for your morning summary.");

  const { error } = await supabaseAdmin
    .from("agents")
    .update({ slack_user_id: slack || null, timezone: input.timezone, digest_hour: input.digest_hour })
    .eq("id", agent.id);
  if (error) return fail("Couldn't save your settings.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- Migz AI ----------

const PROPOSAL_TTL_MS = 48 * 3_600_000;

export async function decideMigzAction(actionId: string, decision: "approve" | "reject"): Promise<Result> {
  const agent = await requireAgent();
  const { data: action } = await supabaseAdmin
    .from("ad_actions")
    .select("id, status, payload, created_at, title")
    .eq("id", actionId)
    .eq("agent_id", agent.id)
    .maybeSingle();
  if (!action || action.status !== "proposed") return fail("That suggestion was already handled.");

  const decidedAt = new Date().toISOString();
  if (decision === "reject") {
    await supabaseAdmin.from("ad_actions").update({ status: "rejected", decided_at: decidedAt }).eq("id", actionId);
    revalidatePath("/dashboard");
    return { ok: true };
  }

  if (Date.now() - new Date(action.created_at).getTime() > PROPOSAL_TTL_MS) {
    await supabaseAdmin.from("ad_actions").update({ status: "expired", decided_at: decidedAt }).eq("id", actionId);
    revalidatePath("/dashboard");
    return fail("That suggestion is more than 2 days old, so results have moved on. Migz will suggest again if it still makes sense.");
  }
  if (!migzReadyFor(agent)) return fail("Migz isn't connected to your ad account yet.");

  // Claim it before the slow re-check, so a double click or a second tab can't apply it twice.
  // Before the run-safety migration allows "applying", the claim errors and approval works unclaimed as before.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("ad_actions")
    .update({ status: "applying" })
    .eq("id", actionId)
    .eq("status", "proposed")
    .select("id");
  if (!claimError && !claimed?.length) return fail("That suggestion was already handled.");

  // Re-check against the latest numbers: things may have changed since Migz suggested this
  const payload = action.payload as ActionPayload;
  let blocked: string | null;
  try {
    await syncAgent(agent);
    const snapshot = await buildSnapshot(agent);
    const ctx = await buildEvalContext(agent, snapshot);
    // Same paced cap as the review: approving a budget change can't take the batch over budget either
    const pacing = await batchPacing(agent, await getActiveBatch(agent.id));
    if (pacing) ctx.dailyCapCents = Math.min(ctx.dailyCapCents, pacing.dailyCapCents);
    blocked = recheck(payload, ctx);
  } catch {
    // Couldn't check it right now: hand it back so it can be approved again
    await supabaseAdmin.from("ad_actions").update({ status: "proposed" }).eq("id", actionId).eq("status", "applying");
    return fail("Couldn't check the latest numbers with Meta. Try again in a minute.");
  }
  if (blocked) {
    await supabaseAdmin
      .from("ad_actions")
      .update({ status: "failed", decided_at: decidedAt, result: { error: blocked } })
      .eq("id", actionId);
    revalidatePath("/dashboard");
    return fail(`This can't go ahead anymore: ${blocked}`);
  }

  const applied = await applyPayload(agent, payload, actionId, { title: action.title ?? undefined }).catch((e) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : "Something went wrong.",
  }));
  await supabaseAdmin
    .from("ad_actions")
    .update(
      applied.ok
        ? { status: "applied", decided_at: decidedAt, result: applied.result }
        : { status: "failed", decided_at: decidedAt, result: { error: applied.error } },
    )
    .eq("id", actionId);
  revalidatePath("/dashboard", "layout");
  return applied.ok ? { ok: true } : fail(applied.error);
}

export async function setMigzMode(mode: "off" | "approve" | "auto"): Promise<Result> {
  const agent = await requireAgent();
  if (!["off", "approve", "auto"].includes(mode)) return fail("Unknown mode.");
  const { error } = await supabaseAdmin.from("agents").update({ migz_mode: mode }).eq("id", agent.id);
  if (error) return fail("Couldn't change how Migz works.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Settings: how Migz finds leads (booking page only, or instant forms too). Takes effect at the next review. */
export async function setIntentLevel(level: IntentLevel): Promise<Result> {
  const agent = await requireAgent();
  if (!isIntentLevel(level)) return fail("Choose a lead style.");
  const { error } = await supabaseAdmin.from("agents").update({ intent_level: level }).eq("id", agent.id);
  if (error) return fail("Couldn't save your lead style. If this keeps happening, the latest migration may not have run yet.");
  // Builds (or retires) the instant-form ad set now rather than at the next review. Only that: never a full
  // review, which could make new creatives (agents can't start creative generation themselves)
  if ((agent.intent_level ?? DEFAULT_INTENT) !== level && agent.onboarding_completed_at && migzReadyFor(agent) && agent.migz_mode !== "off")
    after(async () => {
      const fresh = (await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single()).data as Agent;
      await syncLeadStyle(fresh, null).catch((e) => console.error("applying the lead style failed", e));
    });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Settings: the video model Migz makes videos on. A Seedance tier is charged per video from the ad funds. */
export async function setVideoTier(tier: VideoTier): Promise<Result> {
  const agent = await requireAgent();
  if (!isVideoTier(tier)) return fail("Choose a video quality.");
  const { error } = await supabaseAdmin.from("agents").update({ video_tier: tier }).eq("id", agent.id);
  if (error) return fail("Couldn't save your video quality. If this keeps happening, the latest migration may not have run yet.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** The booking page's font (My page). */
export async function setPageFont(key: string): Promise<Result> {
  const agent = await requireAgent();
  if (!PAGE_FONT_KEYS.includes(key)) return fail("Unknown font.");
  const { error } = await supabaseAdmin.from("agents").update({ page_font: key }).eq("id", agent.id);
  if (error) return fail(error.code === "42703" || error.code === "PGRST204" ? "Page fonts aren't set up yet." : "Couldn't save the font.");
  revalidatePath("/dashboard/landing");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

/** Ghost bookings: hold back some open times on the booking page so the calendar looks busy. */
export async function setGhostBookings(on: boolean): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin.from("agents").update({ ghost_bookings: !!on }).eq("id", agent.id);
  if (error) return fail(error.code === "42703" ? "Ghost bookings aren't set up yet." : "Couldn't save that.");
  revalidatePath("/dashboard/settings");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

/** "Call now" on the booking page: on/off, the number it dials, and whether it shows only during working hours. */
export async function setCallButton(input: { on: boolean; phone: string; hoursOnly: boolean }): Promise<Result> {
  const agent = await requireAgent();
  const phone = input.phone.trim() ? usPhone(input.phone) : null;
  if (input.phone.trim() && !phone) return fail("Enter a 10-digit US phone number.");
  if (input.on && !phone) return fail("Add the number people should call first.");
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ call_button: !!input.on, call_phone: phone, call_hours_only: !!input.hoursOnly })
    .eq("id", agent.id);
  if (error) return fail(error.code === "42703" ? "The call button isn't set up yet." : "Couldn't save that.");
  revalidatePath("/dashboard/settings");
  revalidatePath(`/${agent.slug}`);
  return { ok: true };
}

// Based on the last full review (not quiet hourly checks, which would keep resetting it)
const MANUAL_REVIEW_COOLDOWN_MS = 10 * 60_000;

export async function runMigzNow(): Promise<Result> {
  const agent = await requireAgent();
  // Staff only: a review can launch new creatives, so agents get "Get an update" instead
  if (!(await isAnryhAdmin())) return fail("Migz checks your ads on its own several times a day. Use Get an update to see what it's doing.");
  if (agent.migz_mode === "off") return fail("Migz is turned off. Turn it on in Settings first.");
  if (!migzReadyFor(agent)) return fail("Migz isn't connected to your ad account yet.");
  if (!agent.onboarding_completed_at) return fail("Finish setting up first: Start here walks you through it, and starting your first batch turns Migz on.");
  if (agent.migz_last_operator_at && Date.now() - new Date(agent.migz_last_operator_at).getTime() < MANUAL_REVIEW_COOLDOWN_MS) {
    return fail("Migz just finished a review. Give it a few minutes, then try again.");
  }
  // The review takes a minute or more, so it runs after this response is sent and the dashboard sends
  // the agent to the Brain page, which shows it live. Failures appear there (and alert Anryh Labs).
  after(async () => {
    await runMigz(agent, { trigger: "manual" }).catch((e) => console.error("manual review crashed", e));
  });
  return { ok: true };
}

// ---------- Migz brain ----------

/** An outside ad the agent wants Migz to learn from. Haiku tags it from the link and notes. */
export async function addSwipe(input: { url: string; advertiser: string; notes: string }): Promise<Result> {
  const agent = await requireAgent();
  const notes = clean(input.notes, 1000);
  const url = clean(input.url, 500);
  if (!notes) return fail("Describe what the ad does and why you like it.");
  if (url && !/^https?:\/\//i.test(url)) return fail("Links need to start with http:// or https://");
  const { data, error } = await supabaseAdmin
    .from("swipe_files")
    .insert({ agent_id: agent.id, source_url: url || null, advertiser: clean(input.advertiser, 120) || null, notes, added_by: "agent" })
    .select("id")
    .single();
  if (error || !data) return fail("Couldn't save that example.");
  if (process.env.ANTHROPIC_API_KEY) {
    const budget = await monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000, agent.timezone);
    await traitSwipe(data.id, { agentId: agent.id, runId: null, budget, createMessage: defaultCreateMessage }).catch(() => null);
  }
  revalidatePath("/dashboard/brain");
  return { ok: true };
}

export async function deleteSwipe(id: string): Promise<Result> {
  const agent = await requireAgent();
  await supabaseAdmin.from("swipe_files").delete().eq("id", id).eq("agent_id", agent.id);
  revalidatePath("/dashboard/brain");
  return { ok: true };
}

// ---------- Campaign batches ----------

/** The mode a batch runs in: the agent's choice when they made one, otherwise what they had (never "off"). */
const modeFor = (agent: Agent, autoRun: boolean | undefined) =>
  autoRun === undefined ? (agent.migz_mode === "off" ? "approve" : agent.migz_mode) : autoRun ? "auto" : "approve";

/** One start-flow submission: the agent's answers, lead style, video quality and daily budget. */
export type CampaignChoice = {
  answers: unknown;
  states: string[];
  intentLevel: IntentLevel;
  videoTier: VideoTier;
  dailyCents: number;
  autoRun?: boolean;
  renew?: boolean;
  /** A roofer's service area, asked in the flow in place of licensed states. */
  area?: { service_area: string; state: string; radius: number; crews: number; license: string } | null;
};

type Resolved = {
  answers: CampaignAnswers;
  states: string[];
  area?: { service_area: string; service_radius_miles: number; crews: number; company_license: string | null } | null;
  focus: TopicKey[];
  intent: IntentLevel;
  tier: VideoTier;
  money: ReturnType<typeof campaignMoney>;
  row: Record<string, unknown> & { budget_cents: number; days: number; daily_cents: number };
};

const cleanStates = (raw: unknown) =>
  [...new Set((Array.isArray(raw) ? raw : []).map((s) => clean(s, 2).toUpperCase()))].filter((s) => US_STATES.has(s));

/** Re-derives everything from the agent's choices on the server (never trusting the client's numbers). */
async function resolveCampaign(agent: Agent, input: CampaignChoice): Promise<Resolved | string> {
  const answers = cleanAnswers(input.answers);
  const roof = isRoofer(agent);
  if (roof) answers.products = answers.products.filter((p) => ROOFING_TOPIC_KEYS.includes(p));
  if (!answers.products.length) return roof ? "Choose at least one thing to advertise." : "Choose at least one product to advertise.";
  let area: Resolved["area"] = null;
  let states: string[];
  if (roof) {
    const raw = input.area;
    const where = clean(raw?.service_area, 160);
    const state = clean(raw?.state, 2).toUpperCase();
    if (where.length < 3) return "Add the address, city or ZIP your crews work from.";
    if (!STATE_CODES.includes(state)) return "Pick the state your service area is in.";
    const radius = Math.round(Number(raw?.radius));
    if (!(radius >= MIN_RADIUS_MILES && radius <= MAX_RADIUS_MILES)) return `Choose a radius between ${MIN_RADIUS_MILES} and ${MAX_RADIUS_MILES} miles.`;
    const unfound = await placeProblem(where, state, radius);
    if (unfound) return unfound;
    area = { service_area: where, service_radius_miles: radius, crews: Number(raw?.crews) === 2 ? 2 : 1, company_license: clean(raw?.license, 40) || null };
    states = [state];
  } else {
    states = cleanStates(input.states);
    if (!states.length) return "Choose the states you're licensed in.";
  }
  const daily = Math.round(Number(input.dailyCents));
  if (!Number.isInteger(daily) || daily < MIN_CAMPAIGN_DAILY_CENTS || daily > MAX_CAMPAIGN_DAILY_CENTS)
    return `Choose a daily budget between $${MIN_CAMPAIGN_DAILY_CENTS / 100} and $${(MAX_CAMPAIGN_DAILY_CENTS / 100).toLocaleString("en-US")}.`;
  // Roofers run the booking page only: an inspection needs an address and a time
  const intent = roof ? "medium_high" : isIntentLevel(input.intentLevel) ? input.intentLevel : DEFAULT_INTENT;
  const tier = isVideoTier(input.videoTier) ? input.videoTier : DEFAULT_VIDEO_TIER;
  const plan = dailyBatch(daily, answers.products, await getBatchHistory(agent));
  return {
    answers,
    states,
    area,
    focus: answers.products,
    intent,
    tier,
    money: campaignMoney({ dailyCents: daily, intent, tier, vertical: roof ? "roofing" : "insurance" }),
    row: {
      agent_id: agent.id,
      budget_cents: plan.dailyCents * plan.days,
      option: plan.key,
      campaigns: plan.campaigns.map((t) => t ?? ""),
      days: plan.days,
      daily_cents: plan.dailyCents,
      collect_days: plan.collectDays,
      renew: true, // rolling: the next weekly cycle starts on its own while the balance covers it
      recommended_option: plan.key,
      reason: plan.reason.slice(0, 400),
    },
  };
}

/** What the agent can't afford yet, in plain words, or null. */
function shortOf(r: Resolved, balance: number) {
  if (r.money.neededCents <= balance) return null;
  const videos = r.money.videoCents ? ` plus ${usdShort(r.money.videoCents)} for the campaign's ${VIDEO_TIERS[r.tier].title} videos` : "";
  return `This campaign starts with two weeks of ad spend, ${usdShort(r.money.startSpendCents)}${videos}, and your ad balance is ${usdShort(balance)}. Add funds (we recommend ${usdShort(r.money.recommendedFundsCents)} in ad funds), choose a smaller daily budget${r.money.videoCents ? ", or switch videos to Standard" : ""}.`;
}
const usdShort = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Saves the answers on the agent (prefilled next time), with the focus, states and the two ad choices. */
async function saveCampaignAnswers(agent: Agent, r: Resolved, autoRun: boolean | undefined) {
  const base = { ad_focus: r.focus, licensed_states: r.states, migz_mode: modeFor(agent, autoRun), ...(r.area ?? {}) };
  const { error } = await supabaseAdmin.from("agents").update({ ...base, campaign_answers: r.answers, intent_level: r.intent, video_tier: r.tier }).eq("id", agent.id);
  if (!error) return null;
  // Before the latest migration: keep what the old columns can hold, and say so
  const { error: again } = await supabaseAdmin.from("agents").update(base).eq("id", agent.id);
  return again ? "Couldn't save your answers." : "Couldn't save your answers. The latest migration may not have run yet.";
}

/** Stores Migz's plan on the batch for the Brain page (no-op before its migration). */
async function storePlan(batchId: string, plan: CampaignPlan) {
  await supabaseAdmin.from("campaign_batches").update({ plan }).eq("id", batchId);
}

export type CampaignPreview =
  | { ok: true; plan: CampaignPlan; money: ReturnType<typeof campaignMoney>; balanceCents: number; short: string | null }
  | { ok: false; error: string };

/** The start flow's last screen: Migz's plan for these answers and this daily budget. Reads only. */
export async function previewCampaign(input: CampaignChoice): Promise<CampaignPreview> {
  const agent = await requireAgent();
  const r = await resolveCampaign(agent, input);
  if (typeof r === "string") return { ok: false, error: r };
  const [plan, balanceCents] = await Promise.all([
    buildCampaignPlan(agent, { answers: r.answers, states: r.states, intent: r.intent, dailyCents: r.row.daily_cents }),
    getBalanceCents(agent.id),
  ]);
  return { ok: true, plan, money: r.money, balanceCents, short: shortOf(r, balanceCents) };
}

/** "Start campaign" on the overview: the agent's answers and daily budget, Migz's plan, live right away. */
export async function startBatch(input: CampaignChoice): Promise<Result> {
  const agent = await requireAgent();
  if (!agent.onboarding_completed_at) return fail("Finish setting up first: Start here walks you through it.");
  if (!migzReadyFor(agent)) return fail("Your ad account isn't linked yet. Anryh Labs links it for you.");
  await closeEndedBatch(agent).catch((e) => console.error("closing the ended batch failed", e));
  const open = await getOpenBatch(agent.id);
  if (open?.status === "active") return fail(`Your campaign is running. It's rolling: this week's cycle ends ${open.ends_on} and the next starts on its own.`);
  const r = await resolveCampaign(agent, input);
  if (typeof r === "string") return fail(r);
  const balance = await getBalanceCents(agent.id);
  const short = shortOf(r, balance);
  if (short) return fail(short);
  const saveError = await saveCampaignAnswers(agent, r, input.autoRun);
  if (saveError) return fail(saveError);
  const fresh = { ...agent, ad_focus: r.focus, licensed_states: r.states, campaign_answers: r.answers, intent_level: r.intent, video_tier: r.tier } as Agent;
  const plan = await buildCampaignPlan(fresh, { answers: r.answers, states: r.states, intent: r.intent, dailyCents: r.row.daily_cents });

  if (open) await supabaseAdmin.from("campaign_batches").update({ status: "canceled" }).eq("id", open.id);
  const { data: batch, error } = await supabaseAdmin.from("campaign_batches").insert({ ...r.row, status: "planned" }).select("id").single();
  if (error || !batch) return fail("Couldn't start the campaign. If this keeps happening, the batches migration may not have run yet.");
  await storePlan(batch.id, plan);
  try {
    await activateBatch(fresh, batch.id, r.row, modeFor(agent, input.autoRun));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't start the campaign.");
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/**
 * "Keep going": the running (or planned) batch starts again when it ends, from the free ad balance. Turning
 * it off also cancels a renewal that's waiting on funds. Never charges a card.
 */
export async function setBatchRenew(on: boolean): Promise<Result> {
  const agent = await requireAgent();
  const open = await getOpenBatch(agent.id);
  if (open) {
    const { error } = await supabaseAdmin.from("campaign_batches").update({ renew: on, renew_blocked: null }).eq("id", open.id);
    if (error) return fail("Couldn't change Keep going. If this keeps happening, the sprint and renewal migration may not have run yet.");
  } else if (!on) {
    // No batch running: this cancels a renewal waiting on funds
    const { error } = await supabaseAdmin.from("campaign_batches").update({ renew: false, renew_blocked: null }).eq("agent_id", agent.id).eq("status", "ended").eq("renew", true);
    if (error) return fail("Couldn't change Keep going.");
  } else {
    return fail("Start a batch first; Keep going repeats the batch that's running.");
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Setup: the answers and the first campaign. It starts with "Start my campaign". */
export async function saveBatchPlan(input: CampaignChoice): Promise<Result> {
  const agent = await requireAgent();
  const open = await getOpenBatch(agent.id);
  if (open?.status === "active") return fail("A campaign is already running. Start the next one from the Overview when it ends.");
  const r = await resolveCampaign(agent, input);
  if (typeof r === "string") return fail(r);
  // The run mode chosen with the plan applies once the campaign starts (nothing runs before that)
  const saveError = await saveCampaignAnswers(agent, r, input.autoRun);
  if (saveError) return fail(saveError);
  if (open) await supabaseAdmin.from("campaign_batches").delete().eq("id", open.id).eq("status", "planned");
  const { data: batch, error } = await supabaseAdmin.from("campaign_batches").insert({ ...r.row, status: "planned" }).select("id").single();
  if (error || !batch) return fail("Couldn't save your plan. If this keeps happening, the batches migration may not have run yet.");
  const fresh = { ...agent, ad_focus: r.focus, licensed_states: r.states, campaign_answers: r.answers } as Agent;
  await storePlan(batch.id, await buildCampaignPlan(fresh, { answers: r.answers, states: r.states, intent: r.intent, dailyCents: r.row.daily_cents }));
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- Call outcomes ----------

/** "How did it go?": the agent's one-tap answer for a call or lead (and the monthly premium when it sold). */
export async function setOutcome(kind: OutcomeKind, id: string, outcome: string, premiumDollars?: number): Promise<Result> {
  const agent = await requireAgent();
  if (kind !== "call" && kind !== "lead") return fail("Unknown lead.");
  const premium = typeof premiumDollars === "number" && premiumDollars > 0 ? Math.round(premiumDollars * 100) : null;
  // The same path as a card or Slack tap, so "Couldn't reach" starts the missed-call emails here too
  const ok = await clientTap(agent, { kind, id: clean(id, 40) }, clean(outcome, 40), premium);
  if (!ok) return fail("Couldn't save that. If this keeps happening, the latest migration may not have run yet.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- Client cards ----------

const subjectOf = (kind: unknown, id: unknown): Subject | null => (kind === "call" || kind === "lead") && typeof id === "string" && id ? { kind, id: clean(id, 40) } : null;
const MIGRATION_HINT = "Couldn't save that. If this keeps happening, the latest migration may not have run yet.";
// An entry's time: what the agent picked, never in the future
const entryTime = (at: unknown) => {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return new Date(Number.isFinite(t) ? Math.min(t, Date.now()) : Date.now()).toISOString();
};

/** A card's timeline (the logged entries; the card adds "came in" and "booked" from what it already has). */
export async function loadClientActivity(subjects: { kind: OutcomeKind; id: string }[]): Promise<{ ok: true; activities: ClientActivity[] } | { ok: false; error: string }> {
  const agent = await requireAgent();
  const list = (subjects ?? []).slice(0, 4).map((s) => subjectOf(s?.kind, s?.id)).filter((s): s is Subject => !!s);
  return { ok: true, activities: await getClientActivity(agent.id, list) };
}

/** One tap on a card: an outcome, or "tried_call" / "sent_email" (logged, and the automated emails start when they're on). */
export async function tapClient(kind: OutcomeKind, id: string, action: string, premiumDollars?: number): Promise<Result> {
  const agent = await requireAgent();
  const subject = subjectOf(kind, id);
  if (!subject) return fail("Unknown client.");
  const premium = typeof premiumDollars === "number" && premiumDollars > 0 ? Math.round(premiumDollars * 100) : null;
  if (!(await clientTap(agent, subject, clean(action, 40), premium))) return fail(MIGRATION_HINT);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** "Tried to call", "Sent an email" or "Couldn't reach" on a card: saved, and the matching automated emails start. Says what happened to them. */
export async function reachOut(kind: OutcomeKind, id: string, action: "tried_call" | "sent_email" | "not_reached"): Promise<{ ok: true; started: boolean; sentNow: boolean; reason: string | null } | { ok: false; error: string }> {
  const agent = await requireAgent();
  const subject = subjectOf(kind, id);
  if (!subject || !["tried_call", "sent_email", "not_reached"].includes(action) || (action === "not_reached" && !startsFollowUps(subject.kind, action)))
    return { ok: false, error: "Unknown client." };
  const res = action === "tried_call" ? await triedToCall(agent, subject) : action === "sent_email" ? await sentAnEmail(agent, subject) : await couldntReach(agent, subject);
  if (!res.ok) return { ok: false, error: MIGRATION_HINT };
  revalidatePath("/dashboard", "layout");
  return { ok: true, started: res.started, sentNow: res.sentNow, reason: res.reason };
}

/** The Automated emails tab: both sequences (subjects, bodies, how many, and when each goes). */
export async function saveEmailSequences(input: unknown): Promise<Result> {
  const agent = await requireAgent();
  const current = sequencesFor(agent);
  const raw = (input ?? {}) as Record<string, unknown>;
  const next: Record<string, Sequence> = {};
  for (const { key, title } of SEQUENCES) {
    const s = cleanSequence(raw[key], current[key]);
    if (typeof s === "string") return fail(`${title}: ${s}`);
    next[key] = s;
  }
  const { error } = await supabaseAdmin.from("agents").update({ email_sequences: next }).eq("id", agent.id);
  if (error) return fail(error.code === "42703" || error.code === "PGRST204" ? "Automated emails aren't switched on yet. Please try again shortly." : "Couldn't save your emails.");
  revalidatePath("/dashboard/emails");
  return { ok: true };
}

export async function changeClientStatus(kind: OutcomeKind, id: string, status: string): Promise<Result> {
  const agent = await requireAgent();
  const subject = subjectOf(kind, id);
  if (!subject || !isClientStatus(status)) return fail("Unknown status.");
  if (!(await setClientStatus(agent.id, subject, status))) return fail(MIGRATION_HINT);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function saveNotesFor(kind: OutcomeKind, id: string, notes: string): Promise<Result> {
  const agent = await requireAgent();
  const subject = subjectOf(kind, id);
  if (!subject) return fail("Unknown client.");
  if (!(await saveClientNotes(agent.id, subject, String(notes ?? "")))) return fail("Couldn't save your notes.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function addActivity(kind: OutcomeKind, id: string, entry: { kind: string; body: string; at: string }): Promise<Result> {
  const agent = await requireAgent();
  const subject = subjectOf(kind, id);
  if (!subject || !isAgentActivityKind(entry?.kind)) return fail("Pick what happened.");
  const body = clean(entry.body, 2000);
  if (entry.kind === "note" && !body) return fail("Write the note first.");
  if (!(await addClientActivity(agent, subject, entry.kind, body, entryTime(entry.at)))) return fail(MIGRATION_HINT);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function editActivity(activityId: string, entry: { kind: string; body: string; at: string }): Promise<Result> {
  const agent = await requireAgent();
  if (!isAgentActivityKind(entry?.kind)) return fail("Pick what happened.");
  if (!(await updateClientActivity(agent.id, clean(activityId, 40), { kind: entry.kind, body: clean(entry.body, 2000), at: entryTime(entry.at) }))) return fail("Couldn't save that entry.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Adds a personal client: someone who reached the agent outside Migz (called them directly, a referral). */
export async function addClient(input: { name: string; phone: string; email: string; foundVia: string; coverage: string; status: string; notes: string }): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const agent = await requireAgent();
  const res = await addPersonalClient(agent.id, {
    name: clean(input?.name, 120),
    phone: clean(input?.phone, 40),
    email: clean(input?.email, 200),
    foundVia: clean(input?.foundVia, 120),
    coverage: clean(input?.coverage, 80),
    status: input?.status === "current" ? "current" : "prospect",
    notes: clean(input?.notes, 5000),
  });
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}

export async function removeActivity(activityId: string): Promise<Result> {
  const agent = await requireAgent();
  if (!(await deleteClientActivity(agent.id, clean(activityId, 40)))) return fail("Couldn't delete that entry.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Automated emails on or off for the agent (the switch at the top of the Automated emails tab). */
export async function setFollowUpEmails(on: boolean): Promise<Result> {
  const agent = await requireAgent();
  const { error } = await supabaseAdmin.from("agents").update({ followup_emails: !!on }).eq("id", agent.id);
  if (error) return fail(error.code === "42703" ? "Follow-up emails aren't set up yet." : "Couldn't save that.");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/emails");
  return { ok: true };
}

// ---------- Start here ----------

export async function setCreativeMode(mode: "upload" | "ai" | "both"): Promise<Result> {
  const agent = await requireAgent();
  if (!["upload", "ai", "both"].includes(mode)) return fail("Choose how you want your creatives made.");
  const { error } = await supabaseAdmin.from("agents").update({ creative_mode: mode }).eq("id", agent.id);
  if (error) return fail("Couldn't save that choice.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Finishes setup: starts the planned batch, and Migz's first review runs in the background. */
export async function launchCampaign(): Promise<Result> {
  const agent = await requireAgent();
  if (!migzReadyFor(agent)) return fail("Your ad account isn't linked yet. Anryh Labs links it for you; you'll be able to start as soon as it's done.");
  const blockers = await setupBlockers(agent);
  if (blockers.length) return fail(blockers[0]);
  const planned = await getOpenBatch(agent.id);
  if (!planned || planned.status !== "planned") return fail("Plan your first campaign in Start here first.");
  const balance = await getBalanceCents(agent.id);
  const money = campaignMoney({
    dailyCents: planned.daily_cents,
    intent: isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT,
    tier: isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER,
  });
  // A campaign starts with two weeks funded (plus its videos)
  if (money.neededCents > balance)
    return fail(`Your campaign starts with two weeks funded: ${usdShort(money.neededCents)}${money.videoCents ? ` (with ${usdShort(money.videoCents)} for videos)` : ""}, and your ad balance is ${usdShort(balance)}. Add funds (we recommend ${usdShort(money.recommendedFundsCents)} in ad funds) or choose a smaller daily budget.`);

  const { error } = await supabaseAdmin.from("agents").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", agent.id);
  if (error) return fail("Couldn't start your campaign. Please try again.");
  try {
    await activateBatch(agent, planned.id, planned, modeFor(agent, undefined));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't start your campaign. Please try again.");
  }
  // The booked-call guarantee's 30 days start now, at the campaign's daily budget
  await startGuarantee({ ...agent, daily_budget_cents: planned.daily_cents });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

// ---------- Roofing: service area, crews, license, CRM webhook ----------

/** Why Meta can't target this service area, or null (also null when Meta can't be reached: it's checked again at launch). */
async function placeProblem(area: string, state: string, miles: number) {
  try {
    return (await radiusCenter(area, state, miles)) ? null : `Meta couldn't find "${area}". Use your ZIP code, your city, or a full street address.`;
  } catch {
    return null;
  }
}

export async function saveRoofingSettings(input: { service_area: string; state: string; radius: number; crews: number; license: string; crm_webhook_url: string }): Promise<Result> {
  const agent = await requireAgent();
  if (!isRoofer(agent)) return fail("This is only for roofing accounts.");
  const area = clean(input.service_area, 160);
  if (area.length < 3) return fail("Add the address, city or ZIP your crews work from.");
  const state = clean(input.state, 2).toUpperCase();
  if (!STATE_CODES.includes(state)) return fail("Pick the state your service area is in.");
  const radius = Math.round(Number(input.radius));
  if (!(radius >= MIN_RADIUS_MILES && radius <= MAX_RADIUS_MILES)) return fail(`Choose a radius between ${MIN_RADIUS_MILES} and ${MAX_RADIUS_MILES} miles.`);
  const crews = Number(input.crews) === 2 ? 2 : 1;
  const hook = clean(input.crm_webhook_url, 500);
  if (hook && !validWebhookUrl(hook)) return fail("The CRM webhook must be an https:// link (from Zapier, Make or your CRM).");
  const unfound = await placeProblem(area, state, radius);
  if (unfound) return fail(unfound);
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ service_area: area, service_radius_miles: radius, licensed_states: [state], crews, company_license: clean(input.license, 40) || null, crm_webhook_url: hook || null })
    .eq("id", agent.id);
  if (error) return fail(missingColumn(error.code) ? "Roofing settings aren't switched on yet. Please try again shortly." : "Couldn't save that.");
  // A new area or radius goes to Meta now, not at the next review
  const moved = area !== agent.service_area || radius !== agent.service_radius_miles;
  if (moved && agent.meta_ad_account_id) {
    const fresh = { ...agent, service_area: area, service_radius_miles: radius, licensed_states: [state] };
    after(async () => {
      await retargetNow(fresh).catch((e) => console.error("re-targeting failed", e));
    });
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Sends a sample booking to the roofer's CRM webhook, so they can map the fields in Zapier. */
export async function testCrmWebhook(url: string): Promise<Result> {
  const agent = await requireAgent();
  const hook = clean(url, 500);
  if (!validWebhookUrl(hook)) return fail("Enter an https:// webhook link first.");
  const sample = { id: "00000000-0000-0000-0000-000000000000", starts_at: new Date(Date.now() + 86_400_000).toISOString(), ends_at: new Date(Date.now() + 90_000_000).toISOString(), name: "Sample Homeowner", email: "sample@example.com", phone: "+15550140199" };
  const answers = { property_address: { label: "Address", value: "123 Sample St, Springfield, IL 62701" }, homeowner: { label: "Owns", value: "Yes" }, roof_issue: { label: "Issue", value: "Storm or hail" }, roof_age: { label: "Age", value: "10–20 years" } };
  try {
    const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "MigzAI-Webhook/1" }, body: JSON.stringify({ ...crmPayload(agent, sample, answers), test: true }), redirect: "error", signal: AbortSignal.timeout(10_000) });
    return res.ok ? { ok: true } : fail(`Your webhook answered ${res.status}. Check the link.`);
  } catch {
    return fail("Couldn't reach that link.");
  }
}
