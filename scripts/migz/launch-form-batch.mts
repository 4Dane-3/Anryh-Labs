// One-off: starts an agent's next batch as an instant-form-only campaign with creatives we made by hand.
// Ends the running batch early (its unspent money back in the balance, no "batch ended" message), starts a new
// batch at the given daily budget, puts the whole budget on one instant-form ad set in the main campaign (the
// booking-page ad set stays paused), uploads the creatives in creatives.json as ads with their copy, and turns
// Migz to auto. The batch is marked applied, so Migz's setup doesn't re-split the budget or make its own mix.
// Usage (from the repo root):
//   NODE_PATH=scripts/migz/stubs npx tsx --env-file=.env.local --tsconfig ./tsconfig.json scripts/migz/launch-form-batch.mts miguel-cruz 5000 <creatives.json>
//     shows what it would do and changes nothing
//   ... miguel-cruz 5000 <creatives.json> --go
// Optional --days=N sets the batch length (else Migz's recommendation for the daily budget). When the balance
// can't cover the batch (Meta bills the agent's own card), --cover adds the difference as an adjustment.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

(globalThis as { WebSocket?: unknown }).WebSocket ??= class {};
const { DateTime } = await import("luxon");
const { supabaseAdmin } = await import("@/lib/supabase-admin");
const { graph } = await import("@/lib/meta/graph");
const { createAdSet, uploadImage, uploadVideo, videoState, createAdCreative, createAd, setStatus } = await import("@/lib/meta/ads");
const { landingUrl } = await import("@/lib/booking/sites");
const { dailyBatch, batchEndTime } = await import("@/lib/batch");
const { endDate } = await import("@/lib/campaign");
const { getBatchHistory, getActiveBatch, ensureBatchSetAside } = await import("@/lib/dashboard/batches");
const { getBalanceCents } = await import("@/lib/dashboard/queries");
const { ensureLeadForm } = await import("@/lib/migz/leads");
const { syncAgent } = await import("@/lib/migz/sync");
const { cleanFocus } = await import("@/lib/migz/topics");
type Agent = import("@/lib/booking/data").Agent;

type CreativeSpec = { file: string; name: string; headline: string; primaryText: string };

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [slug, dailyArg, specFile] = args.filter((a) => !a.startsWith("--"));
const go = flags.includes("--go") ? "--go" : undefined;
const cover = flags.includes("--cover");
// After a run that stopped partway (e.g. Meta refused the form): keeps the batch it made and builds the rest
const resume = flags.includes("--resume");
const daysFlag = Number(flags.find((f) => f.startsWith("--days="))?.split("=")[1]) || null;
if (!slug || !dailyArg || !specFile) throw new Error("Usage: launch-form-batch.mts <slug> <dailyCents> <creatives.json> [--days=N] [--cover] [--go]");
const daily = Number(dailyArg);
const specs = JSON.parse(await readFile(specFile, "utf8")) as CreativeSpec[];
const dir = dirname(specFile);
const { data: agentRow } = await supabaseAdmin.from("agents").select("*").eq("slug", slug).single();
const agent = agentRow as Agent;
if (!agent?.meta_ad_account_id || !agent.meta_page_id) throw new Error(`No agent ${slug} with a Meta ad account and Page`);
const account = agent.meta_ad_account_id;
const now = () => new Date().toISOString();

// ---------- What's there now ----------
const running = await getActiveBatch(agent.id);
const { data: mains } = await supabaseAdmin.from("ad_campaigns").select("id, meta_campaign_id, name, status").eq("agent_id", agent.id).eq("role", "main").is("retired_at", null);
if (mains?.length !== 1) throw new Error(`Expected one live main campaign, found ${mains?.length ?? 0}`);
const main = mains[0];
const metaCampaign = await graph<{ effective_status: string }>("GET", main.meta_campaign_id, { fields: "effective_status" });
const { data: sets } = await supabaseAdmin.from("ad_sets").select("id, meta_adset_id, name, status, destination, daily_budget_cents").eq("campaign_id", main.id);
const focus = cleanFocus(agent.ad_focus);
const recommended = dailyBatch(daily, focus, await getBatchHistory(agent));
const plan = daysFlag ? { ...recommended, days: daysFlag, collectDays: Math.min(recommended.collectDays, Math.max(1, daysFlag - 3)) } : recommended;
const balance = await getBalanceCents(agent.id);
const today = DateTime.now().setZone(agent.timezone).toISODate()!;
const ends = endDate(today, plan.days)!;
console.log(JSON.stringify({
  agent: { mode: agent.migz_mode, intent: agent.intent_level, ads_paused: agent.ads_paused, daily: agent.daily_budget_cents, focus, lead_form: agent.meta_lead_form_id, lead_form_blocked: agent.lead_form_blocked },
  running: running && { id: running.id, budget: running.budget_cents, starts: running.starts_on, ends: running.ends_on },
  main: { ...main, meta: metaCampaign.effective_status, sets },
  next: { daily, days: plan.days, budget: daily * plan.days, starts: today, ends, campaigns: plan.campaigns },
  balance_now: balance,
  creatives: specs.map((s) => s.file),
}, null, 1));
if (go !== "--go") process.exit(0);

// ---------- 1. End the running batch (spend synced first; unspent back in the balance) ----------
if (resume && (!running || running.starts_on !== today || running.budget_cents !== daily * plan.days)) throw new Error("--resume needs the batch this script started today");
if (running && !resume) {
  await syncAgent(agent);
  const since = running.starts_on!;
  const { data: spendRows } = await supabaseAdmin.from("ad_insights_daily").select("spend_cents").eq("agent_id", agent.id).gte("date", since).lte("date", today);
  const spent = (spendRows ?? []).reduce((s, r) => s + r.spend_cents, 0);
  const { count: booked } = await supabaseAdmin.from("bookings").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).neq("status", "cancelled").gte("created_at", DateTime.fromISO(since, { zone: agent.timezone }).toUTC().toISO()!);
  await supabaseAdmin.from("campaign_batches").update({ status: "ended", ended_at: now(), ends_on: today, result: { spent_cents: spent, booked_calls: booked ?? 0 } }).eq("id", running.id).eq("status", "active");
  const { data: setAside } = await supabaseAdmin.from("wallet_transactions").select("id").eq("external_id", `batch:${running.id}`).maybeSingle();
  const back = running.budget_cents - spent;
  if (setAside && back > 0)
    await supabaseAdmin.from("wallet_transactions").insert({ agent_id: agent.id, kind: "refund", amount_cents: back, status: "completed", description: `Unspent from your $${running.budget_cents / 100} batch, back in your balance`, external_id: `batch:${running.id}:return` });
  console.log(`✓ Ended batch ${running.id}: spent $${(spent / 100).toFixed(2)}, ${booked ?? 0} booked, $${(Math.max(0, back) / 100).toFixed(2)} back`);
}

if (!resume) {
// The balance has to cover the batch before its money is set aside
const short = daily * plan.days - (await getBalanceCents(agent.id));
if (short > 0) {
  if (!cover) throw new Error(`The balance is $${(short / 100).toFixed(2)} short of the batch; add funds or pass --cover`);
  await supabaseAdmin.from("wallet_transactions").insert({ agent_id: agent.id, kind: "adjustment", amount_cents: short, status: "completed", description: "Added by Anryh Labs to cover this batch (Meta bills your card directly)" });
  console.log(`✓ Added $${(short / 100).toFixed(2)} so the balance covers the batch`);
}

// ---------- 2. The new batch, already applied (we build its ad set below) ----------
const { data: batch, error: batchError } = await supabaseAdmin
  .from("campaign_batches")
  .insert({
    agent_id: agent.id,
    status: "active",
    budget_cents: daily * plan.days,
    option: plan.key,
    campaigns: plan.campaigns.map((t) => t ?? ""),
    days: plan.days,
    daily_cents: daily,
    collect_days: plan.collectDays,
    renew: false,
    recommended_option: plan.key,
    reason: `Instant forms only at $${daily / 100}/day for ${plan.days} days: 2 podcast videos and 11 image angles, every one opening the free-quote form.`,
    starts_on: today,
    ends_on: ends,
    started_at: now(),
    applied_at: now(),
  })
  .select("id")
  .single();
if (batchError || !batch) throw new Error(`Couldn't create the batch: ${batchError?.message}`);
await supabaseAdmin
  .from("agents")
  .update({ daily_budget_cents: daily, campaign_days: plan.days, campaign_started_on: today, campaign_ends_on: ends, intent_level: "low_medium", migz_mode: "auto", migz_last_run_at: null, migz_last_operator_at: null })
  .eq("id", agent.id);
await ensureBatchSetAside((await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single()).data as Agent);
console.log(`✓ Batch ${batch.id}: $${(daily * plan.days) / 100} over ${plan.days} days (${today} to ${ends}), set aside`);
}
const fresh = (await supabaseAdmin.from("agents").select("*").eq("id", agent.id).single()).data as Agent;

// ---------- 3. The instant form and its ad set (all of the daily budget) ----------
const formId = await ensureLeadForm(fresh);
if (!formId) throw new Error(`No lead form: ${fresh.lead_form_blocked}`);
if (metaCampaign.effective_status !== "ACTIVE") await setStatus(main.meta_campaign_id, "ACTIVE");
const adsetName = `${fresh.licensed_states.join(", ")} · adults 18+ · instant form`;
const adsetId = await createAdSet(account, {
  campaignId: main.meta_campaign_id,
  name: adsetName,
  dailyBudgetCents: daily,
  pixelId: process.env.META_PIXEL_ID!,
  states: fresh.licensed_states,
  placements: [],
  status: "ACTIVE",
  endTime: batchEndTime(ends, fresh.timezone),
  instantForm: { pageId: fresh.meta_page_id! },
});
const { data: setRow } = await supabaseAdmin
  .from("ad_sets")
  .insert({ agent_id: agent.id, campaign_id: main.id, meta_adset_id: adsetId, name: adsetName, status: "ACTIVE", daily_budget_cents: daily, states: fresh.licensed_states, optimization_event: "LEAD", destination: "instant_form" })
  .select("id")
  .single();
console.log(`✓ Lead form ${formId}; ad set ${adsetId} at $${daily / 100}/day`);

// ---------- 4. The ads ----------
const link = landingUrl(fresh.slug, process.env.APP_URL);
const made: { name: string; adId: string }[] = [];
for (const s of specs) {
  const file = join(dir, s.file);
  const bytes = await readFile(file);
  const isVideo = file.endsWith(".mp4");
  const mime = isVideo ? "video/mp4" : "image/png";
  const path = `${agent.id}/form-batch-${Date.now()}-${s.file}`;
  const up = await supabaseAdmin.storage.from("creatives").upload(path, bytes, { contentType: mime });
  if (up.error) throw up.error;
  let media: Parameters<typeof createAdCreative>[1]["media"];
  let metaMedia: Record<string, string> = {};
  if (isVideo) {
    const { data: signed } = await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 3600);
    const videoId = await uploadVideo(account, signed!.signedUrl, s.name);
    let state = await videoState(videoId);
    for (let i = 0; (state.status !== "ready" || !state.thumbnail) && i < 60; i++) {
      if (state.status === "error") throw new Error(`Meta couldn't process ${s.file}`);
      await new Promise((r) => setTimeout(r, 10_000));
      state = await videoState(videoId);
    }
    if (state.status !== "ready" || !state.thumbnail) throw new Error(`${s.file} still ${state.status} after 10 minutes`);
    media = { kind: "video", videoId, thumbnailUrl: state.thumbnail };
    metaMedia = { meta_video_id: videoId };
  } else {
    const imageHash = await uploadImage(account, bytes, s.name);
    media = { kind: "image", imageHash };
    metaMedia = { meta_image_hash: imageHash };
  }
  const creativeId = await createAdCreative(account, { name: s.name, pageId: fresh.meta_page_id!, instagramId: fresh.meta_instagram_id, link, primaryText: s.primaryText, headline: s.headline, leadFormId: formId, media });
  const adId = await createAd(account, { name: s.name, adsetId, creativeId, status: "ACTIVE" });
  const { data: lib } = await supabaseAdmin
    .from("creatives")
    .insert({ agent_id: agent.id, kind: isVideo ? "video" : "image", storage_path: path, file_name: s.file, mime_type: mime, size_bytes: bytes.length, status: "live", ...metaMedia })
    .select("id")
    .single();
  await supabaseAdmin.from("ads").insert({ agent_id: agent.id, adset_id: setRow?.id, creative_id: lib?.id ?? null, meta_ad_id: adId, meta_creative_id: creativeId, name: s.name, status: "ACTIVE", primary_text: s.primaryText, headline: s.headline });
  made.push({ name: s.name, adId });
  console.log(`✓ ${s.name}: ad ${adId}`);
}

// ---------- 5. Ads on, and only this ad set ----------
// The last pause listed the old booking-page ad sets; a resume naming only this one keeps Migz from turning them back on
await supabaseAdmin.from("ad_actions").insert({ agent_id: agent.id, kind: "launch", title: "Resumed your ads", detail: "Your new batch is on: instant forms only.", status: "applied", tool: "system_resume", payload: { adset_ids: [adsetId] } });
await supabaseAdmin.from("agents").update({ ads_paused: false }).eq("id", agent.id);
await supabaseAdmin.from("ad_actions").insert({
  agent_id: agent.id,
  kind: "launch",
  title: `Set up your $${(daily * plan.days) / 100} batch`,
  detail: `Instant forms only: $${daily / 100}/day for ${plan.days} days on one ad set in ${fresh.licensed_states.join(", ")}, with ${made.length} ads (2 podcast videos and ${made.length - 2} images). Each opens your free-quote form; the thank-you screen offers your booking page. Migz is on auto.`,
  status: "applied",
  tool: "system_setup",
});
console.log(JSON.stringify(made, null, 1));
