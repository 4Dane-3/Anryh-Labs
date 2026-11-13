import "server-only";
import type { BetaMessageParam, BetaToolResultBlockParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { adLinkFor } from "@/lib/booking/sites";
import { areaLabel } from "@/lib/verticals";
import { cleanRules, describeRules } from "@/lib/roofing/job-rules";
import { emit } from "@/lib/migz/events";
import { callModel, defaultCreateMessage, monthlyBudget, planTier, textOf, type CreateMessage } from "@/lib/migz/router";
import { sendSlackMessage } from "@/lib/slack";
import { googleAdsReady, GoogleAdsError, mutate } from "@/lib/google-ads/api";
import { getGoogleAccount, manageable, refreshLink, saveGoogleAccount, type GoogleAccount } from "@/lib/google-ads/account";
import { buildCampaign, ensureConversions } from "@/lib/google-ads/build";
import { sendConversions } from "@/lib/google-ads/conversions";
import { execute, type ExecTarget } from "@/lib/google-ads/executor";
import { checkAction, needsApproval, targetCpa, type GAction, type GuardCtx } from "@/lib/google-ads/guardrails";
import { dailyFromMonthly, GOOGLE_MIN_MONTHLY_CENTS, MAX_ACTIONS_PER_REVIEW, REVIEW_INSTRUCTIONS } from "@/lib/google-ads/playbook";
import { syncGoogleAccount } from "@/lib/google-ads/sync";
import { parseAction, GOOGLE_TOOLS } from "@/lib/google-ads/tools";
import { cpaCents, type GoogleSnapshot } from "@/lib/google-ads/types";
import { competitorIntel } from "@/lib/competitors/intel";

// Migz on Google Ads, run from the hourly Migz cron. Each run, per linked roofer:
//   1. a pending link is rechecked (did they accept it in Google Ads?)
//   2. once they've started their campaign, the Search campaign is built (once)
//   3. the numbers are synced, and the monthly cap is enforced in code (paused at the cap, back on next month)
//   4. booked inspections and closed jobs go back to Google as conversions
//   5. once a day, Migz reviews the account with its tools; every change passes the guardrails, and an
//      ask-first roofer's changes that could raise spend or change the ads wait for their OK

const REVIEW_EVERY_HOURS = 20;
const CLAIM_SECONDS = 330;
const MAX_TURNS = 6;
const DAY = 86_400_000;

const FEED_KIND: Partial<Record<GAction["tool"], string>> = {
  add_negative_keywords: "audience",
  add_keywords: "audience",
  pause_keyword: "pause",
  pause_ad: "pause",
  resume_keyword: "launch",
  write_ad: "creative",
  set_daily_budget: "budget",
  set_bidding: "budget",
};

async function brandFacts(agentId: string) {
  const { data } = await supabaseAdmin.from("agent_brand").select("deals, certifications, warranties").eq("agent_id", agentId).maybeSingle();
  return (data as { deals?: string[]; certifications?: string[]; warranties?: string[] } | null) ?? null;
}

export const guardCtxFor = (account: GoogleAccount, snapshot: GoogleSnapshot): GuardCtx => ({
  snapshot,
  campaignId: account.campaign_id,
  monthlyCapCents: account.monthly_cap_cents,
  launchedAt: account.launched_at,
  lastBudgetChangeAt: account.last_budget_change_at,
  lastBiddingChangeAt: account.last_bidding_change_at,
});

const targetFor = (agent: Agent, account: GoogleAccount): ExecTarget => ({ customerId: account.customer_id, campaignId: account.campaign_id ?? "", budgetResource: account.budget_resource, landingUrl: adLinkFor(agent, process.env.APP_URL) });

async function logAction(agentId: string, row: { tool: string; payload: unknown; title: string; reason: string; status: string; result?: unknown }) {
  const { data } = await supabaseAdmin.from("google_ads_actions").insert({ agent_id: agentId, ...row, decided_at: row.status === "proposed" ? null : new Date().toISOString() }).select("id").single();
  return (data?.id as string) ?? null;
}

/** Shows an applied change in the roofer's activity feed, next to Meta's. */
async function feed(agentId: string, a: GAction, title: string, reason: string) {
  const kind = FEED_KIND[a.tool];
  if (!kind) return;
  await supabaseAdmin.from("ad_actions").insert({ agent_id: agentId, kind, title: `Google Ads: ${title}`.slice(0, 120), detail: reason, status: "applied", tool: `google_${a.tool}`, payload: a });
}

/** Applies a checked change and records what happened (budget and bidding changes start their wait). */
export async function applyChecked(agent: Agent, account: GoogleAccount, a: GAction, title: string, reason: string) {
  try {
    const res = await execute(a, targetFor(agent, account));
    const now = new Date().toISOString();
    if (a.tool === "set_daily_budget") await saveGoogleAccount(agent.id, { last_budget_change_at: now });
    if (a.tool === "set_bidding") await saveGoogleAccount(agent.id, { last_bidding_change_at: now });
    if (a.tool !== "hold") await feed(agent.id, a, title, reason);
    return { ok: true as const, result: res };
  } catch (e) {
    return { ok: false as const, error: e instanceof GoogleAdsError ? e.message : e instanceof Error ? e.message : String(e) };
  }
}

/** Keeps the campaign within the roofer's cap and on/off switch, without asking the model. */
async function enforceSpend(agent: Agent, account: GoogleAccount, snapshot: GoogleSnapshot) {
  const camp = snapshot.campaigns.find((c) => c.id === account.campaign_id);
  if (!camp) return;
  const cap = dailyFromMonthly(account.monthly_cap_cents);
  // The daily budget never sits above the cap (the roofer may have lowered it)
  if (camp.budgetResource && camp.dailyBudgetCents > cap && cap >= 1000) {
    const a: GAction = { tool: "set_daily_budget", daily_cents: cap };
    const r = await applyChecked(agent, account, a, `Lowered the daily budget to $${(cap / 100).toFixed(2)}`, "Brought it under your monthly Google cap.");
    await logAction(agent.id, { tool: a.tool, payload: a, title: "Lowered the daily budget to your cap", reason: "Monthly cap changed.", status: r.ok ? "applied" : "failed", result: r });
  }
  const want = account.enabled && !agent.ads_paused && snapshot.monthSpendCents < account.monthly_cap_cents ? "ENABLED" : "PAUSED";
  if (camp.status === want) return;
  if (want === "ENABLED") {
    // Only switch back on what Migz itself paused
    const { data: last } = await supabaseAdmin.from("google_ads_actions").select("tool").eq("agent_id", agent.id).in("tool", ["system_pause", "system_resume"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.tool !== "system_pause") return;
  }
  await mutate(account.customer_id, [{ campaignOperation: { update: { resourceName: `customers/${account.customer_id}/campaigns/${camp.id}`, status: want }, updateMask: "status" } }]);
  const why = want === "ENABLED" ? "A new month started (or you switched Google back on), so the campaign is running again." : !account.enabled || agent.ads_paused ? "You switched Google ads off." : `This month's spend reached your $${(account.monthly_cap_cents / 100).toLocaleString("en-US")} Google cap.`;
  await logAction(agent.id, { tool: want === "ENABLED" ? "system_resume" : "system_pause", payload: { campaign_id: camp.id }, title: want === "ENABLED" ? "Turned the Google campaign back on" : "Paused the Google campaign", reason: why, status: "applied" });
  await supabaseAdmin.from("ad_actions").insert({ agent_id: agent.id, kind: want === "ENABLED" ? "launch" : "pause", title: want === "ENABLED" ? "Google Ads: campaign back on" : "Google Ads: campaign paused", detail: why, status: "applied", tool: "google_system" });
}

/** The numbers and facts the review reads, trimmed to what matters. */
function reviewInput(agent: Agent, account: GoogleAccount, snapshot: GoogleSnapshot, brand: Awaited<ReturnType<typeof brandFacts>>, recent: unknown[], intel: unknown) {
  const c = guardCtxFor(account, snapshot);
  const m = (x: { costCents: number; clicks: number; impressions: number; conversions: number }) => ({ cost: x.costCents / 100, clicks: x.clicks, impr: x.impressions, conv: x.conversions });
  return {
    today: new Date().toLocaleDateString("en-US", { timeZone: agent.timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    facts: {
      company: agent.full_name,
      service_area: areaLabel(agent),
      jobs_they_take: describeRules(cleanRules(agent.job_rules)),
      offer: agent.lead_goal === "quote" ? "free quote" : "free roof inspection",
      special: brand?.deals?.filter(Boolean) ?? [],
      certifications: brand?.certifications?.filter(Boolean) ?? [],
      warranties: brand?.warranties?.filter(Boolean) ?? [],
      license: agent.company_license ?? null,
      avg_job_dollars: agent.avg_job_dollars ?? null,
    },
    competitor_research: intel,
    money: {
      monthly_cap: account.monthly_cap_cents / 100,
      max_daily_budget: dailyFromMonthly(account.monthly_cap_cents) / 100,
      spent_this_month: snapshot.monthSpendCents / 100,
      target_cost_per_conversion: (targetCpa(c) ?? 0) / 100 || null,
      cost_per_conversion_30d: (cpaCents(snapshot.totals30) ?? 0) / 100 || null,
    },
    days_since_launch: account.launched_at ? Math.floor((Date.now() - Date.parse(account.launched_at)) / DAY) : null,
    days_since_budget_change: account.last_budget_change_at ? Math.floor((Date.now() - Date.parse(account.last_budget_change_at)) / DAY) : null,
    days_since_bidding_change: account.last_bidding_change_at ? Math.floor((Date.now() - Date.parse(account.last_bidding_change_at)) / DAY) : null,
    totals_30d: m(snapshot.totals30),
    totals_7d: m(snapshot.totals7),
    campaigns: snapshot.campaigns.map((x) => ({ id: x.id, name: x.name, status: x.status, bidding: x.bidding, target_cpa: x.targetCpaCents ? x.targetCpaCents / 100 : null, daily_budget: x.dailyBudgetCents / 100, impression_share: x.impressionShare, lost_to_budget: x.lostToBudget, lost_to_rank: x.lostToRank, ...m(x) })),
    ad_groups: snapshot.adGroups.map((g) => ({ id: g.id, name: g.name, status: g.status })),
    keywords_30d: snapshot.keywords.slice(0, 120).map((k) => ({ ad_group_id: k.adGroupId, criterion_id: k.criterionId, text: k.text, match: k.match, status: k.status, qs: k.qualityScore, ...m(k) })),
    search_terms_14d: snapshot.searchTerms.slice(0, 180).map((s) => ({ term: s.term, status: s.status, ad_group_id: s.adGroupId, ...m(s) })),
    ads_30d: snapshot.ads.map((a) => ({ ad_group_id: a.adGroupId, ad_id: a.adId, status: a.status, strength: a.strength, approval: a.approval, headlines: a.headlines, descriptions: a.descriptions, ...m(a) })),
    negatives: snapshot.negatives.map((n) => `${n.text} (${n.match.toLowerCase()})`),
    your_recent_changes: recent,
  };
}

/** Migz's daily review: the model reads the account and acts through the guarded tools. */
async function review(agent: Agent, account: GoogleAccount, snapshot: GoogleSnapshot, createMessage: CreateMessage) {
  const plan = planTier("operator", await monthlyBudget(agent.id, agent.migz_model_budget_cents, agent.timezone));
  if (!plan) return { actions: 0, proposed: 0, summary: "Skipped: model budget used." };
  const [brand, { data: recent }, intel] = await Promise.all([
    brandFacts(agent.id),
    supabaseAdmin.from("google_ads_actions").select("tool, title, reason, status, created_at").eq("agent_id", agent.id).gte("created_at", new Date(Date.now() - 14 * DAY).toISOString()).order("created_at", { ascending: false }).limit(30),
    competitorIntel(agent.id).catch(() => "none yet"),
  ]);
  const mode = agent.migz_mode === "auto" ? "auto" : "approve";
  const ctx = guardCtxFor(account, snapshot);
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: `Today's Google Ads review. ${mode === "approve" ? "This roofer asks first: blocking searches and pausing losers happen right away; anything else you call is sent to them to approve." : "This roofer lets you act on your own within the rules."}\n\n${JSON.stringify(reviewInput(agent, account, snapshot, brand, recent ?? [], intel), null, 1)}`,
    },
  ];
  let actions = 0;
  let proposed = 0;
  let summary = "";
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await callModel({
      task: "operator",
      tier: plan.tier,
      degraded: plan.degraded,
      agentId: agent.id,
      runId: null,
      createMessage,
      params: { max_tokens: 8000, system: [{ type: "text", text: REVIEW_INSTRUCTIONS, cache_control: { type: "ephemeral" } }], tools: GOOGLE_TOOLS, messages },
    });
    const msg = res.message;
    if (textOf(msg)) summary = textOf(msg);
    const uses = msg.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !uses.length) break;
    messages.push({ role: "assistant", content: msg.content });
    const results: BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const reply = (content: string, isError = false) => results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      if (actions >= MAX_ACTIONS_PER_REVIEW) {
        reply(`That's ${MAX_ACTIONS_PER_REVIEW} changes this review: stop here and summarize.`, true);
        continue;
      }
      const parsed = parseAction(use.name, use.input);
      if ("error" in parsed) {
        reply(parsed.error, true);
        continue;
      }
      const why = checkAction(parsed.action, ctx);
      if (why) {
        reply(`Not done: ${why}`, true);
        continue;
      }
      actions++;
      if (parsed.action.tool === "hold") {
        await logAction(agent.id, { tool: "hold", payload: {}, title: parsed.title, reason: parsed.reason, status: "applied" });
        reply("Noted.");
        continue;
      }
      if (mode === "approve" && needsApproval(parsed.action, ctx)) {
        proposed++;
        await logAction(agent.id, { tool: parsed.action.tool, payload: parsed.action, title: parsed.title, reason: parsed.reason, status: "proposed" });
        reply("Sent to the roofer to approve.");
        continue;
      }
      const r = await applyChecked(agent, account, parsed.action, parsed.title, parsed.reason);
      await logAction(agent.id, { tool: parsed.action.tool, payload: parsed.action, title: parsed.title, reason: parsed.reason, status: r.ok ? "applied" : "failed", result: r });
      reply(r.ok ? "Done." : `Google rejected it: ${r.error}`, !r.ok);
    }
    messages.push({ role: "user", content: results });
  }
  return { actions, proposed, summary };
}

async function claim(agentId: string) {
  const token = new Date().toISOString();
  const stale = new Date(Date.now() - CLAIM_SECONDS * 1000).toISOString();
  const { data } = await supabaseAdmin.from("google_ads_accounts").update({ review_claimed_at: token }).eq("agent_id", agentId).or(`review_claimed_at.is.null,review_claimed_at.lt.${stale}`).select("agent_id");
  return data?.length ? token : null;
}

export type GoogleRunResult = { status: string; built?: boolean; conversions?: { booked: number; closed: number }; actions?: number; proposed?: number };

/** One roofer's Google Ads run (see the top of this file). */
export async function runGoogleAds(agent: Agent, opts: { force?: boolean; createMessage?: CreateMessage } = {}): Promise<GoogleRunResult> {
  if (!googleAdsReady()) return { status: "not_configured" };
  let account = await getGoogleAccount(agent.id);
  if (!account) return { status: "no_account" };
  if (account.link_status === "pending") account = (await refreshLink(agent.id)).account ?? account;
  if (!manageable(account)) return { status: account.link_status };
  if (!agent.onboarding_completed_at) return { status: "setup_not_finished" };
  if (!opts.force && account.failed_at && Date.now() - Date.parse(account.failed_at) < Math.min(6, 2 ** Math.max(0, account.fail_count - 1)) * 3_600_000) return { status: "backing_off" };
  const lock = await claim(agent.id);
  if (!lock) return { status: "busy" };
  try {
    let built = false;
    if (!account.campaign_id && account.enabled && account.monthly_cap_cents >= GOOGLE_MIN_MONTHLY_CENTS) {
      const b = await buildCampaign(agent, account);
      built = b.built;
      if (b.built) {
        account = (await getGoogleAccount(agent.id)) ?? account;
        const title = `Built your Google Search campaign (${b.groups} ad group${b.groups === 1 ? "" : "s"})`;
        const reason = "Google Search only, people in your service area, phrase and exact keywords for the jobs you take, starting negatives, call and callout assets, Maximize conversions.";
        await logAction(agent.id, { tool: "system_build", payload: { campaign_id: b.campaignId }, title, reason, status: "applied" });
        await supabaseAdmin.from("ad_actions").insert({ agent_id: agent.id, kind: "launch", title: `Google Ads: ${title}`, detail: reason, status: "applied", tool: "google_system" });
        await emit({ agentId: agent.id, runId: null, step: "acting", tier: "code", summary: title });
      }
    } else if (account.campaign_id) {
      await ensureConversions(agent, account).then((c) => (account = { ...account!, conversion_actions: c }));
    }
    const snapshot = await syncGoogleAccount(agent.id, account.customer_id);
    await emit({ agentId: agent.id, runId: null, step: "syncing", tier: "code", summary: `Synced Google Ads: $${(snapshot.totals7.costCents / 100).toFixed(0)} spent, ${snapshot.totals7.conversions} conversions in 7 days` });
    if (account.campaign_id) await enforceSpend(agent, account, snapshot);
    const conversions = await sendConversions(account, agent.avg_job_dollars ?? null);

    let actions = 0;
    let proposed = 0;
    const due = opts.force || !account.reviewed_at || Date.now() - Date.parse(account.reviewed_at) > REVIEW_EVERY_HOURS * 3_600_000;
    if (due && account.campaign_id && agent.migz_mode !== "off") {
      const r = await review(agent, account, snapshot, opts.createMessage ?? defaultCreateMessage);
      actions = r.actions;
      proposed = r.proposed;
      await saveGoogleAccount(agent.id, { reviewed_at: new Date().toISOString() });
      await emit({ agentId: agent.id, runId: null, step: "finished", tier: "sonnet", summary: `Google Ads review: ${actions} change${actions === 1 ? "" : "s"}${proposed ? `, ${proposed} waiting for your OK` : ""}`, evidence: { summary: r.summary.slice(0, 1500) } });
      if (proposed && agent.slack_user_id && process.env.SLACK_BOT_TOKEN)
        await sendSlackMessage(agent.slack_user_id, `Migz has ${proposed} Google Ads change${proposed === 1 ? "" : "s"} waiting for your OK: ${(process.env.APP_URL ?? "").replace(/\/$/, "")}/dashboard/google`).catch(() => null);
    }
    await saveGoogleAccount(agent.id, { failed_at: null, fail_count: 0, last_error: null });
    return { status: "ok", built, conversions, actions, proposed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await saveGoogleAccount(agent.id, { failed_at: new Date().toISOString(), fail_count: (account.fail_count ?? 0) + 1, last_error: message.slice(0, 500) });
    return { status: "failed" };
  } finally {
    await supabaseAdmin.from("google_ads_accounts").update({ review_claimed_at: null }).eq("agent_id", agent.id).eq("review_claimed_at", lock);
  }
}

/** Every roofer with a Google Ads account, oldest review first, until the deadline. */
export async function runGoogleAdsAll(deadline: number) {
  if (!googleAdsReady()) return {};
  const { data, error } = await supabaseAdmin.from("google_ads_accounts").select("agent_id").in("link_status", ["pending", "linked", "created"]).order("reviewed_at", { ascending: true, nullsFirst: true }).limit(50);
  if (error || !data?.length) return {};
  const out: Record<string, GoogleRunResult> = {};
  for (const row of data) {
    if (Date.now() > deadline) break;
    const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("id", row.agent_id).single();
    if (agent) out[(agent as Agent).slug] = await runGoogleAds(agent as Agent);
  }
  return out;
}
