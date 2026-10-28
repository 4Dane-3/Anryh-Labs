import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { landingUrl } from "@/lib/booking/sites";
import type { Agent } from "@/lib/booking/data";
import type { Snapshot } from "@/lib/migz/snapshot";
import { begin } from "@/lib/migz/events";
import { callModel, jsonOf, planTier, type Budget, type CreateMessage } from "@/lib/migz/router";

// The auditor: deterministic account checks in code, then Haiku ranks them and writes each one in
// plain English. Findings persist (one open row per check + subject) so the Brain page and the
// operator see the same list, and a finding resolves itself when the check stops firing.

export type Severity = "info" | "warn" | "critical";
export type RawFinding = { check: string; subject: string; severity: Severity; facts: string; evidence: Record<string, unknown> };
export type Finding = RawFinding & { summary: string; isNew: boolean };

export const AUDIT_CHECKS = [
  "disapproved_ads",
  "landing_page",
  "utm_tagging",
  "tracking",
  "pacing",
  "learning",
  "competing_ads",
  "naming",
  "funding",
] as const;

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

async function checkLandingPage(agent: Agent): Promise<RawFinding | null> {
  const url = landingUrl(agent.slug, appUrl());
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - started;
    if (!res.ok) return { check: "landing_page", subject: url, severity: "critical", facts: `The booking page returned HTTP ${res.status}.`, evidence: { url, status: res.status } };
    if (ms > 3000) return { check: "landing_page", subject: url, severity: "warn", facts: `The booking page took ${(ms / 1000).toFixed(1)}s to respond.`, evidence: { url, ms } };
    return null;
  } catch (e) {
    return { check: "landing_page", subject: url, severity: "critical", facts: `The booking page didn't load: ${e instanceof Error ? e.message : String(e)}.`, evidence: { url } };
  }
}

/** All code checks. Pure-ish: reads only what it needs beyond the snapshot. */
export async function runChecks(agent: Agent, snapshot: Snapshot): Promise<RawFinding[]> {
  const out: RawFinding[] = [];
  const since7 = DateTime.now().minus({ days: 7 });
  const monthStart = DateTime.now().setZone(agent.timezone).startOf("month");

  const [{ data: ads }, { data: insights7 }, { data: bookings7 }, { data: monthSpend }, { data: visits }] = await Promise.all([
    supabaseAdmin.from("ads").select("meta_ad_id, name, status, adset_id, creative_id, creatives(hook, source)").eq("agent_id", agent.id),
    supabaseAdmin.from("ad_insights_daily").select("meta_conversions").eq("agent_id", agent.id).gte("date", since7.toISODate()!),
    supabaseAdmin.from("bookings").select("attribution").eq("agent_id", agent.id).gte("created_at", since7.toUTC().toISO()!),
    supabaseAdmin.from("ad_insights_daily").select("spend_cents").eq("agent_id", agent.id).gte("date", monthStart.toISODate()!),
    supabaseAdmin.from("page_visits").select("utm_source, utm_content").eq("agent_id", agent.id).gte("created_at", since7.toUTC().toISO()!),
  ]);

  // 1. Disapproved ads
  for (const ad of ads ?? []) {
    if (ad.status === "DISAPPROVED")
      out.push({ check: "disapproved_ads", subject: ad.meta_ad_id, severity: "critical", facts: `Meta disapproved ad "${ad.name}".`, evidence: { ad_id: ad.meta_ad_id } });
  }

  // 2. Landing page up and fast
  if (snapshot.hasCampaign) {
    const lp = await checkLandingPage(agent);
    if (lp) out.push(lp);
  }

  // 3. UTM tagging: Meta traffic that arrived without the ad id can't be attributed to an ad
  const metaBookings = (bookings7 ?? []).map((b) => b.attribution as Record<string, string>).filter((a) => a?.utm_source === "meta");
  const untaggedBookings = metaBookings.filter((a) => !a.utm_content).length;
  const metaVisits = (visits ?? []).filter((v) => v.utm_source === "meta");
  const untaggedVisits = metaVisits.filter((v) => !v.utm_content).length;
  if (untaggedBookings + untaggedVisits > 0)
    out.push({
      check: "utm_tagging",
      subject: "utm_content",
      severity: "warn",
      facts: `${untaggedBookings} booking(s) and ${untaggedVisits} visit(s) from Meta in 7 days had no utm_content, so they can't be credited to an ad.`,
      evidence: { untagged_bookings: untaggedBookings, untagged_visits: untaggedVisits },
    });

  // 4. Tracking: our Meta bookings vs Meta's attributed Schedule events
  const ours = metaBookings.length;
  const metas = (insights7 ?? []).reduce((s, r) => s + (r.meta_conversions ?? 0), 0);
  if (ours >= 2 && metas === 0)
    out.push({ check: "tracking", subject: "schedule_event", severity: "critical", facts: `${ours} booked calls came from Meta in 7 days but Meta recorded no Schedule events: the pixel/CAPI event isn't reaching Meta, so it can't optimize for bookings.`, evidence: { our_bookings: ours, meta_schedule_events: metas } });
  else if (metas > ours * 1.5 + 1)
    out.push({ check: "tracking", subject: "dedupe", severity: "warn", facts: `Meta counted ${metas} Schedule events against ${ours} real bookings in 7 days: pixel and CAPI events may not be deduplicated.`, evidence: { our_bookings: ours, meta_schedule_events: metas } });

  // 5. Pacing: spend so far this month against the daily budget, counted from when the ads started
  const spent = (monthSpend ?? []).reduce((s, r) => s + r.spend_cents, 0);
  const { days, expected } = pacingExpectation({ dailyCents: agent.daily_budget_cents, startedOn: agent.campaign_started_on ?? null, timezone: agent.timezone });
  const since = days < DateTime.now().setZone(agent.timezone).day ? ` since the ads started (${days.toFixed(1)} days)` : " this month";
  const liveSets = snapshot.guardAdsets.filter((a) => a.status === "ACTIVE");
  if (expected > 0 && days >= 1 && spent > expected * 1.1)
    out.push({ check: "pacing", subject: "month", severity: "warn", facts: `Spent $${(spent / 100).toFixed(2)}${since} vs $${(expected / 100).toFixed(2)} planned (${Math.round((spent / expected) * 100)}%).`, evidence: { spent_cents: spent, expected_cents: expected, days: Math.round(days * 10) / 10 } });
  else if (liveSets.length && days >= 3 && expected > 0 && spent < expected * 0.6)
    out.push({ check: "pacing", subject: "month", severity: "warn", facts: `Only $${(spent / 100).toFixed(2)} of $${(expected / 100).toFixed(2)} planned has spent${since} (${Math.round((spent / expected) * 100)}%): ads are under-delivering.`, evidence: { spent_cents: spent, expected_cents: expected, days: Math.round(days * 10) / 10 } });

  // 6. Learning phase stuck or limited
  for (const s of snapshot.guardAdsets) {
    const days = (Date.now() - new Date(s.last_edited_at).getTime()) / 86_400_000;
    const status = (s.learning_status ?? "").toUpperCase();
    if (status === "LEARNING" && days > 7)
      out.push({ check: "learning", subject: s.meta_adset_id, severity: "warn", facts: `Ad set ${s.meta_adset_id} has been learning for ${Math.floor(days)} days; it isn't getting enough bookings to exit.`, evidence: { adset_id: s.meta_adset_id, days } });
    if (status === "FAIL")
      out.push({ check: "learning", subject: s.meta_adset_id, severity: "warn", facts: `Ad set ${s.meta_adset_id} is learning-limited: too few booked calls for Meta to optimize.`, evidence: { adset_id: s.meta_adset_id } });
  }

  // 7. Ads competing in one ad set: too many live ads, or duplicate hooks
  for (const s of snapshot.guardAdsets) {
    const live = s.ads.filter((a) => a.status === "ACTIVE");
    if (live.length > 6)
      out.push({ check: "competing_ads", subject: s.meta_adset_id, severity: "warn", facts: `${live.length} live ads share ad set ${s.meta_adset_id}; budget is spread too thin for any to get a fair read.`, evidence: { adset_id: s.meta_adset_id, live: live.length } });
  }
  // Different creatives with the same hook compete; copy variants of one creative are deliberate tests
  const hooks = new Map<string, { ids: string[]; creatives: Set<string> }>();
  for (const ad of (ads ?? []).filter((a) => a.status === "ACTIVE")) {
    const hook = ((ad.creatives as { hook?: string } | null)?.hook ?? "").trim().toLowerCase();
    if (!hook) continue;
    const entry = hooks.get(`${ad.adset_id}|${hook}`) ?? { ids: [], creatives: new Set<string>() };
    entry.ids.push(ad.meta_ad_id);
    entry.creatives.add(ad.creative_id ?? ad.meta_ad_id);
    hooks.set(`${ad.adset_id}|${hook}`, entry);
  }
  for (const [key, { ids, creatives }] of hooks)
    if (creatives.size > 1)
      out.push({ check: "competing_ads", subject: `hook:${key}`, severity: "info", facts: `${ids.length} live ads in one ad set use the same hook "${key.split("|")[1]}"; they compete for the same people.`, evidence: { ad_ids: ids } });

  // 8. Naming convention: "Migz · <concept>" for our ads, "Upload · ..." or "Migz · Agent upload" for uploads
  for (const ad of ads ?? []) {
    if (!/^(Migz|Upload) · /.test(ad.name))
      out.push({ check: "naming", subject: ad.meta_ad_id, severity: "info", facts: `Ad "${ad.name}" doesn't follow the "Migz · <angle>" naming, so reports group it poorly.`, evidence: { ad_id: ad.meta_ad_id, name: ad.name } });
  }

  // 9. Funding runway
  const daysLeft = snapshot.forModel.agent.days_of_funding_left;
  if (daysLeft !== null && daysLeft < 3)
    out.push({ check: "funding", subject: "balance", severity: daysLeft < 1 ? "critical" : "warn", facts: `The balance covers about ${daysLeft} more day(s) of ads.`, evidence: { days_left: daysLeft } });

  return out;
}

const AUDIT_SYSTEM = `You are the auditor on Migz AI's ad team for an independent life insurance agent's Meta ads. You receive the results of automatic account checks. For each one, write a one-sentence plain-English summary for the agent that says what is wrong and why it matters, keeping the numbers. You may move a severity by at most one level when the facts clearly justify it. Return them most urgent first. Never invent findings or numbers that aren't in the input.`;

const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          check: { type: "string" },
          subject: { type: "string" },
          severity: { type: "string", enum: ["info", "warn", "critical"] },
          summary: { type: "string" },
        },
        required: ["check", "subject", "severity", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
const step = (s: Severity, to: Severity) => (Math.abs(RANK[s] - RANK[to]) <= 1 ? to : s);

/**
 * How much the ads should have spent by now this month: the daily budget times the days they've been
 * running, counted from the later of the 1st of the month and the day the ads started, up to now.
 */
export function pacingExpectation(input: { dailyCents: number; startedOn: string | null; timezone: string; now?: Date }) {
  const now = DateTime.fromJSDate(input.now ?? new Date()).setZone(input.timezone);
  const monthStart = now.startOf("month");
  const started = input.startedOn ? DateTime.fromISO(input.startedOn, { zone: input.timezone }).startOf("day") : monthStart;
  const from = started > monthStart ? started : monthStart;
  const days = Math.max(0, now.diff(from, "days").days);
  return { days, expected: Math.round(input.dailyCents * days) };
}

const sameEvidence = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Runs the checks, has Haiku word them (only when the set of findings changed since last time), and
 * syncs audit_findings. Returns the open findings and whether anything new and serious appeared.
 */
export async function audit(agent: Agent, snapshot: Snapshot, ctx: { runId: string; budget: Budget; createMessage: CreateMessage }) {
  const done = await begin({ agentId: agent.id, runId: ctx.runId, step: "auditing", tier: "code", summary: `Running ${AUDIT_CHECKS.length} account checks` });
  const raw = await runChecks(agent, snapshot);

  const { data: existing } = await supabaseAdmin
    .from("audit_findings")
    .select("check_name, subject, severity, summary, evidence")
    .eq("agent_id", agent.id)
    .eq("status", "open")
    // Only the auditor's own checks: routines file and resolve theirs (fatigue, spend anomalies)
    .in("check_name", [...AUDIT_CHECKS]);
  const key = (f: { check_name?: string; check?: string; subject: string }) => `${f.check_name ?? f.check}|${f.subject}`;
  const prev = new Map((existing ?? []).map((f) => [key(f), f]));
  const changed = raw.some((f) => prev.get(key(f))?.severity !== f.severity) || prev.size !== raw.length;

  let worded = new Map<string, { severity: Severity; summary: string }>();
  let model: string | null = null;
  let tokens = { input: 0, output: 0 };
  const plan = planTier("audit", ctx.budget);
  if (raw.length && changed && plan) {
    const res = await callModel({
      task: "audit",
      tier: plan.tier,
      degraded: plan.degraded,
      agentId: agent.id,
      runId: ctx.runId,
      createMessage: ctx.createMessage,
      params: {
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema: AUDIT_SCHEMA } },
        system: [{ type: "text", text: AUDIT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: JSON.stringify(raw.map(({ check, subject, severity, facts }) => ({ check, subject, severity, facts }))) }],
      },
    });
    model = res.model;
    tokens = { input: res.usage.input, output: res.usage.output };
    const parsed = jsonOf<{ findings: { check: string; subject: string; severity: Severity; summary: string }[] }>(res.message);
    worded = new Map((parsed?.findings ?? []).map((f) => [`${f.check}|${f.subject}`, { severity: f.severity, summary: f.summary }]));
  }

  const now = new Date().toISOString();
  const findings: Finding[] = raw.map((f) => {
    const w = worded.get(key(f));
    const old = prev.get(key(f));
    return {
      ...f,
      severity: w ? step(f.severity, w.severity) : (old?.severity as Severity) ?? f.severity,
      // Keep the last wording only while its numbers still hold; otherwise the plain facts, which are current
      summary: w?.summary ?? (old && sameEvidence(old.evidence, f.evidence) ? old.summary : f.facts),
      isNew: !old,
    };
  });
  if (findings.length) {
    await supabaseAdmin.from("audit_findings").upsert(
      findings.map((f) => ({
        agent_id: agent.id,
        check_name: f.check,
        subject: f.subject,
        severity: f.severity,
        summary: f.summary,
        evidence: f.evidence,
        status: "open",
        last_seen: now,
        resolved_at: null,
      })),
      { onConflict: "agent_id,check_name,subject" },
    );
  }
  const stillOpen = new Set(findings.map((f) => key(f)));
  const resolved = (existing ?? []).filter((f) => !stillOpen.has(key(f)));
  for (const f of resolved)
    await supabaseAdmin
      .from("audit_findings")
      .update({ status: "resolved", resolved_at: now })
      .eq("agent_id", agent.id)
      .eq("check_name", f.check_name)
      .eq("subject", f.subject);

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const counts = { critical: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  await done({
    summary: findings.length
      ? `${findings.length} finding(s): ${counts.critical} critical, ${counts.warn} to watch${resolved.length ? `; ${resolved.length} resolved` : ""}`
      : `All ${AUDIT_CHECKS.length} checks passed${resolved.length ? `; ${resolved.length} resolved` : ""}`,
    evidence: { counts, resolved: resolved.length, model, checks: AUDIT_CHECKS.length },
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    ...(model ? { tier: "haiku" as const, model } : {}),
  });

  return {
    findings,
    material: findings.some((f) => f.isNew && f.severity !== "info"),
  };
}
