"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAgent } from "@/lib/auth";
import { integrations, migzReadyFor } from "@/lib/integrations";
import { buildEvalContext, runMigz } from "@/lib/migz/agent";
import { applyPayload } from "@/lib/migz/executor";
import { buildSnapshot } from "@/lib/migz/snapshot";
import { syncAgent } from "@/lib/migz/sync";
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
  if (!within(input.buffer_minutes, 0, 120)) return fail("Buffer must be 0–120 minutes.");
  if (!within(input.min_notice_hours, 0, 168)) return fail("Notice must be 0–168 hours.");
  if (!within(input.max_days_ahead, 1, 90)) return fail("Booking window must be 1–90 days.");

  const { error: settingsError } = await supabaseAdmin
    .from("agents")
    .update({
      slot_minutes: input.slot_minutes,
      buffer_minutes: input.buffer_minutes,
      min_notice_hours: input.min_notice_hours,
      max_days_ahead: input.max_days_ahead,
    })
    .eq("id", agent.id);
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

export async function updateDailyBudget(cents: number): Promise<Result> {
  const agent = await requireAgent();
  if (!Number.isInteger(cents) || cents < 500 || cents > 100_000)
    return fail("Daily budget must be between $5 and $1,000.");
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ daily_budget_cents: cents })
    .eq("id", agent.id);
  if (error) return fail("Couldn't update your budget.");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

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
  await requireAgent();
  if (!Number.isInteger(cents) || cents < 2500 || cents > 1_000_000)
    return { ok: false, error: "Deposits must be between $25 and $10,000." };
  if (!integrations.stripe)
    return { ok: false, error: "Payments aren't connected yet, so funds can't be added. This will work once Stripe is set up." };
  // Stripe Checkout goes here once STRIPE_SECRET_KEY is set; the webhook records the deposit.
  return { ok: false, error: "Stripe checkout isn't built yet." };
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
      headline: clean(input.headline, 140) || null,
      bio: clean(input.bio, 1200) || null,
      license_number: clean(input.license_number, 40) || null,
      licensed_states: states,
    })
    .eq("id", agent.id);
  if (error) return fail("Couldn't save your page.");
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
  const rating = input.rating && input.rating >= 1 && input.rating <= 5 ? Math.round(input.rating) : null;

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

export async function saveQuestions(questions: IntakeQuestion[]): Promise<Result> {
  const agent = await requireAgent();
  if (!Array.isArray(questions) || questions.length > 40) return fail("You can have up to 40 questions.");

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
  if (error) return fail("Couldn't save your questions.");

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
    .select("id, status, payload, created_at")
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

  const applied = await applyPayload(agent, payload, actionId);
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

const MANUAL_REVIEW_COOLDOWN_MS = 60 * 60_000;

export async function runMigzNow(): Promise<Result & { summary?: string }> {
  const agent = await requireAgent();
  if (agent.migz_mode === "off") return fail("Migz is turned off. Turn it on in Settings first.");
  if (!migzReadyFor(agent)) return fail("Migz isn't connected to your ad account yet.");
  if (agent.migz_last_run_at && Date.now() - new Date(agent.migz_last_run_at).getTime() < MANUAL_REVIEW_COOLDOWN_MS) {
    return fail("Migz reviewed your ads within the last hour. Give results time to come in.");
  }
  const run = await runMigz(agent, { trigger: "manual" });
  revalidatePath("/dashboard", "layout");
  if (run.status === "failed") return fail(`Migz couldn't finish this review: ${run.error}`);
  return { ok: true, summary: run.status === "succeeded" ? run.summary : "Ads are paused, so Migz made no changes." };
}
