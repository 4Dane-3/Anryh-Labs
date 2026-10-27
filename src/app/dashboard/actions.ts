"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAnryhAdmin, requireAgent } from "@/lib/auth";
import { usPhone } from "@/lib/booking/call";
import { integrations, migzReadyFor } from "@/lib/integrations";
import { batchPacing, buildEvalContext, retargetNow, runMigz } from "@/lib/migz/agent";
import { applyPayload } from "@/lib/migz/executor";
import { buildSnapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
import { defaultCreateMessage, monthlyBudget } from "@/lib/migz/router";
import { traitSwipe } from "@/lib/migz/team/scout";
import { cleanFocus, type TopicKey } from "@/lib/migz/topics";
import { PAGE_FONT_KEYS } from "@/lib/booking/page-font-keys";
import { endDate, MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS } from "@/lib/campaign";
import { batchOptions, bestTopic, exploreAdvice, findOption, MIN_BATCH_CENTS, outcomeEstimate, type BatchOption, type BatchOptionKey } from "@/lib/batch";
import { closeEndedBatch, ensureBatchSetAside, getActiveBatch, getBatchHistory, getOpenBatch, recommendWithMigz } from "@/lib/dashboard/batches";
import { getBalanceCents } from "@/lib/dashboard/queries";
import { checkoutReturnBase, createDepositCheckout } from "@/lib/stripe";
import { setupBlockers } from "@/lib/dashboard/setup";
import type { Agent } from "@/lib/booking/data";
import { DateTime } from "luxon";
import { recheck, type ActionPayload } from "@/lib/migz/tools";
import { STEP_TITLES, type IntakeQuestion, type QuestionKind } from "@/lib/booking/questions";

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
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Starts a Stripe Checkout session for an ad-funds deposit. Needs Stripe keys. */
export async function startDeposit(cents: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const agent = await requireAgent();
  if (!Number.isInteger(cents) || cents < MIN_DEPOSIT_CENTS || cents > MAX_DEPOSIT_CENTS)
    return { ok: false, error: `Deposits must be between $${MIN_DEPOSIT_CENTS / 100} and $${(MAX_DEPOSIT_CENTS / 100).toLocaleString("en-US")}.` };
  if (!integrations.stripe)
    return { ok: false, error: "Payments aren't connected yet, so funds can't be added. This will work once Stripe is set up." };
  try {
    const url = await createDepositCheckout({ agentId: agent.id, email: agent.email, cents, appUrl: checkoutReturnBase(), customerId: agent.stripe_customer_id ?? null });
    return { ok: true, url };
  } catch (e) {
    console.error("stripe checkout failed", e);
    return { ok: false, error: "Couldn't open the payment page. Please try again." };
  }
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

  // Re-check against the latest numbers: things may have changed since Migz suggested this
  await syncAgent(agent);
  const snapshot = await buildSnapshot(agent);
  const ctx = await buildEvalContext(agent, snapshot);
  // Same paced cap as the review: approving a budget change can't take the batch over budget either
  const pacing = await batchPacing(agent, await getActiveBatch(agent.id));
  if (pacing) ctx.dailyCapCents = Math.min(ctx.dailyCapCents, pacing.dailyCapCents);
  const payload = action.payload as ActionPayload;
  const blocked = recheck(payload, ctx);
  if (blocked) {
    await supabaseAdmin
      .from("ad_actions")
      .update({ status: "failed", decided_at: decidedAt, result: { error: blocked } })
      .eq("id", actionId);
    revalidatePath("/dashboard");
    return fail(`This can't go ahead anymore: ${blocked}`);
  }

  const applied = await applyPayload(agent, payload, actionId, { title: action.title ?? undefined });
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

export type BatchPlanResult =
  | {
      ok: true;
      options: BatchOption[];
      recommended: { key: BatchOptionKey; reason: string; by: "migz" | "rules" };
      estimate: ReturnType<typeof outcomeEstimate>;
      /** How much more would make room for an exploration campaign (null once the budget covers it). */
      advice: ReturnType<typeof exploreAdvice>;
      /** Why the ads haven't booked, from where their visitors stop on the booking page (null when nothing stands out). */
      diagnosis: { fix: "ads" | "page" | "both"; text: string } | null;
      balanceCents: number;
    }
  | { ok: false; error: string };

/** The ways Migz could spend a batch, and which one it recommends for this agent (from their own history). */
export async function planBatch(budgetCents: number, topics?: string[]): Promise<BatchPlanResult> {
  const agent = await requireAgent();
  const focus = cleanFocus(topics ?? agent.ad_focus);
  if (!focus.length) return { ok: false, error: "Choose what you want to promote first." };
  if (!Number.isInteger(budgetCents) || budgetCents < MIN_BATCH_CENTS)
    return { ok: false, error: `The smallest batch is $${MIN_BATCH_CENTS / 100} of ad spend (a $${MIN_DEPOSIT_CENTS / 100} deposit after the fee).` };
  if (budgetCents > MAX_DEPOSIT_CENTS) return { ok: false, error: `The largest batch is $${(MAX_DEPOSIT_CENTS / 100).toLocaleString("en-US")}.` };
  const history = await getBatchHistory(agent);
  const options = batchOptions(budgetCents, focus, bestTopic(history));
  const [recommended, balanceCents] = await Promise.all([
    recommendWithMigz(agent, { budgetCents, focus, options, history }),
    getBalanceCents(agent.id),
  ]);
  // Only once the ads have run: a first batch has no visits to diagnose
  const verdict = history.spentCents > 0 ? history.page?.verdict : null;
  const diagnosis = verdict && verdict.fix !== "none" ? { fix: verdict.fix, text: verdict.text } : null;
  return { ok: true, options, recommended, estimate: outcomeEstimate(budgetCents, history), advice: exploreAdvice(budgetCents), diagnosis, balanceCents };
}

type BatchChoice = { budgetCents: number; option: string; recommended?: string | null; reason?: string | null; autoRun?: boolean };

/** The mode a batch runs in: the agent's choice when they made one, otherwise what they had (never "off"). */
const modeFor = (agent: Agent, autoRun: boolean | undefined) =>
  autoRun === undefined ? (agent.migz_mode === "off" ? "approve" : agent.migz_mode) : autoRun ? "auto" : "approve";

/** Re-derives the chosen option on the server (never trusting the client's numbers). */
async function resolveChoice(agent: Agent, input: BatchChoice, focus: TopicKey[]) {
  if (!Number.isInteger(input.budgetCents) || input.budgetCents < MIN_BATCH_CENTS || input.budgetCents > MAX_DEPOSIT_CENTS) return null;
  const history = await getBatchHistory(agent);
  const chosen = findOption(input.budgetCents, focus, input.option, bestTopic(history));
  if (!chosen) return null;
  return {
    agent_id: agent.id,
    budget_cents: input.budgetCents,
    option: chosen.key,
    campaigns: chosen.campaigns.map((t) => t ?? ""),
    days: chosen.days,
    daily_cents: chosen.dailyCents,
    recommended_option: ["focused", "balanced", "explore", "spread"].includes(input.recommended ?? "") ? input.recommended : null,
    reason: clean(input.reason, 400) || null,
  };
}

/** Starts a batch: sets the daily spend and dates it implies, then Migz reviews in the background. */
async function activateBatch(agent: Agent, batchId: string, row: { days: number; daily_cents: number }, mode: "approve" | "auto") {
  const today = DateTime.now().setZone(agent.timezone).toISODate()!;
  const ends = endDate(today, row.days);
  await supabaseAdmin
    .from("campaign_batches")
    .update({ status: "active", starts_on: today, ends_on: ends, started_at: new Date().toISOString(), applied_at: null })
    .eq("id", batchId);
  const { error } = await supabaseAdmin
    .from("agents")
    .update({
      daily_budget_cents: row.daily_cents,
      campaign_days: row.days,
      campaign_started_on: today,
      campaign_ends_on: ends,
      ads_paused: false,
      migz_mode: mode,
      migz_last_run_at: null,
      migz_last_operator_at: null,
    })
    .eq("id", agent.id);
  if (error) throw new Error("Couldn't start the batch.");
  const fresh = (await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single()).data as Agent;
  // The batch's money comes out of the balance now (what it doesn't spend comes back when it ends)
  await ensureBatchSetAside(fresh);
  after(async () => {
    await runMigz(fresh, { trigger: "manual" }).catch((e) => console.error("batch review crashed", e));
  });
}

/** "Start campaign batch" on the overview: the agent's money, Migz's plan, live right away. */
export async function startBatch(input: BatchChoice): Promise<Result> {
  const agent = await requireAgent();
  if (!agent.onboarding_completed_at) return fail("Finish setting up first: Start here walks you through it.");
  if (!migzReadyFor(agent)) return fail("Your ad account isn't linked yet. Anryh Labs links it for you.");
  await closeEndedBatch(agent);
  const open = await getOpenBatch(agent.id);
  if (open?.status === "active") return fail(`Your current batch runs until ${open.ends_on}. You can start the next one when it ends.`);
  const focus = cleanFocus(agent.ad_focus);
  if (!focus.length) return fail("Choose what you want to promote on the Setup page first.");
  const balance = await getBalanceCents(agent.id);
  if (input.budgetCents > balance)
    return fail(`Your ad balance is $${(balance / 100).toFixed(2)}. Add funds, or choose a batch of $${(balance / 100).toFixed(0)} or less.`);
  const row = await resolveChoice(agent, input, focus);
  if (!row) return fail("That plan doesn't fit this budget. Pick one of the options shown.");

  if (open) await supabaseAdmin.from("campaign_batches").update({ status: "canceled" }).eq("id", open.id);
  const { data: batch, error } = await supabaseAdmin.from("campaign_batches").insert({ ...row, status: "planned" }).select("id").single();
  if (error || !batch) return fail("Couldn't start the batch. If this keeps happening, the batches migration may not have run yet.");
  try {
    await activateBatch(agent, batch.id, row, modeFor(agent, input.autoRun));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't start the batch.");
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Setup: what to promote and the first batch. It starts with "Start my campaign". */
export async function saveBatchPlan(input: BatchChoice & { topics: string[] }): Promise<Result> {
  const agent = await requireAgent();
  const focus = cleanFocus(input.topics);
  if (!focus.length) return fail("Choose at least one thing to promote.");
  const open = await getOpenBatch(agent.id);
  if (open?.status === "active") return fail("A batch is already running. Start the next one from the Overview when it ends.");
  const row = await resolveChoice(agent, input, focus);
  if (!row) return fail("That plan doesn't fit this budget. Pick one of the options shown.");
  // The run mode chosen with the plan applies once the batch starts (nothing runs before that)
  const { error: focusError } = await supabaseAdmin.from("agents").update({ ad_focus: focus, migz_mode: modeFor(agent, input.autoRun) }).eq("id", agent.id);
  if (focusError) return fail("Couldn't save what you want to promote.");
  if (open) await supabaseAdmin.from("campaign_batches").delete().eq("id", open.id).eq("status", "planned");
  const { error } = await supabaseAdmin.from("campaign_batches").insert({ ...row, status: "planned" });
  if (error) return fail("Couldn't save your plan. If this keeps happening, the batches migration may not have run yet.");
  revalidatePath("/dashboard", "layout");
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
  if (!planned || planned.status !== "planned") return fail("Choose your first batch in step 4.");
  const balance = await getBalanceCents(agent.id);
  if (planned.budget_cents > balance)
    return fail(`Your batch is $${(planned.budget_cents / 100).toFixed(2)} but your ad balance is $${(balance / 100).toFixed(2)}. Add funds or choose a smaller batch.`);

  const { error } = await supabaseAdmin.from("agents").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", agent.id);
  if (error) return fail("Couldn't start your campaign. Please try again.");
  try {
    await activateBatch(agent, planned.id, planned, modeFor(agent, undefined));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't start your campaign. Please try again.");
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
