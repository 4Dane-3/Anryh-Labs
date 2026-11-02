import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { sendSlackMessage } from "@/lib/slack";
import { sendLeadStageEvent, sendOutcomeEvents } from "@/lib/meta/capi";
import { logActivity } from "@/lib/dashboard/activity";
import {
  CALL_OUTCOMES,
  CLIENT_STATUSES,
  LEAD_OUTCOMES,
  isCallOutcome,
  isLeadOutcome,
  outcomeLabel,
  statusForOutcome,
  unsentEvents,
  type ClientStatus,
  type MetaOutcomeEvent,
  type OutcomeKind,
} from "@/lib/outcomes";

// Asking the agent what happened after each lead, recording the answer, and telling Meta about it. The ask
// is one Slack message the morning after (with one-tap links) plus the same list on the dashboard; one
// reminder two days later at most, then it's left unanswered.

/** How a Meta event reads on the client's timeline. */
const metaEventLabel = (e: MetaOutcomeEvent) => ({ ShowedUp: "showed up", Contact: "reached", Purchase: "sold", NotInterested: "not interested" })[e];

const TABLE = { call: "bookings", lead: "quote_requests" } as const;
/** How far back the dashboard and Slack ask about. */
export const ASK_WINDOW_DAYS = 14;
export const REMIND_AFTER_DAYS = 2;
const MAX_IN_SLACK = 8;

export type OutcomeItem = {
  kind: OutcomeKind;
  id: string;
  name: string;
  /** The call's time, or when the lead came in. */
  at: string;
  outcome: string | null;
  premiumCents: number | null;
  source: "booking" | "page" | "instant_form";
};

// ---------- One-tap links ----------

const secret = () => process.env.OUTCOME_LINK_SECRET || process.env.CRON_SECRET || "";
/** Signs a lead, so its link can set that lead's outcome without signing in (and nothing else). */
export function outcomeSignature(kind: OutcomeKind, id: string) {
  const key = secret();
  return key ? createHmac("sha256", key).update(`outcome:${kind}:${id}`).digest("base64url").slice(0, 32) : "";
}
export function validSignature(kind: OutcomeKind, id: string, sig: string | null) {
  const want = outcomeSignature(kind, id);
  if (!want || !sig || sig.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const outcomeUrl = (kind: OutcomeKind, id: string, outcome: string) =>
  `${appUrl()}/o/${kind}/${id}?r=${outcome}&s=${outcomeSignature(kind, id)}`;

// ---------- Recording ----------

type Row = {
  id: string;
  agent_id: string;
  outcome: string | null;
  outcome_sent: string | null;
  client_status: ClientStatus;
  premium_cents: number | null;
  email?: string | null;
  phone: string;
  attribution: Record<string, string> | null;
  meta_lead_id?: string | null;
};

/**
 * Saves an outcome for one of the agent's leads (the agent can change it; the latest answer wins), moves
 * their status (a sale makes them a current client, a no makes them not interested), adds both to their
 * timeline, and sends Meta the follow-up events it hasn't had yet. Returns false when the lead isn't theirs,
 * the outcome isn't valid, or the client-cards migration hasn't run.
 */
export async function recordOutcome(agentId: string, kind: OutcomeKind, id: string, outcome: string, premiumCents?: number | null) {
  if (kind === "call" ? !isCallOutcome(outcome) : !isLeadOutcome(outcome)) return false;
  const cols = `id, agent_id, outcome, outcome_sent, client_status, premium_cents, email, phone, attribution${kind === "lead" ? ", meta_lead_id" : ""}`;
  const { data, error } = await supabaseAdmin.from(TABLE[kind]).select(cols).eq("id", id).eq("agent_id", agentId).maybeSingle();
  const row = data as unknown as Row | null;
  if (error || !row) return false;
  const premium = outcome === "sold" && Number.isInteger(premiumCents) && premiumCents! > 0 && premiumCents! < 10_000_00 ? premiumCents! : null;
  // Taking back a "not interested" makes them a prospect again; any other change of answer keeps the status
  const status = statusForOutcome(outcome) ?? (row.outcome === "not_interested" && row.client_status === "not_interested" ? "prospect" : row.client_status);
  const { error: saveError } = await supabaseAdmin
    .from(TABLE[kind])
    .update({ outcome, outcome_at: new Date().toISOString(), client_status: status, ...(outcome === "sold" ? (premium ? { premium_cents: premium } : {}) : { premium_cents: null }) })
    .eq("id", id);
  if (saveError) return false;

  const subject = { kind, id };
  // Adding the premium to a sale isn't a new answer
  if (outcome !== row.outcome) await logActivity(agentId, subject, "outcome", outcomeLabel(kind, outcome));
  else if (premium && premium !== row.premium_cents) await logActivity(agentId, subject, "outcome", `${outcomeLabel(kind, outcome)}, $${(premium / 100).toFixed(2)}/month`);
  if (status !== row.client_status) await logActivity(agentId, subject, "status", CLIENT_STATUSES.find((s) => s.key === status)!.label);

  const events = unsentEvents(kind, outcome, row.outcome_sent);
  if (events.length) {
    try {
      let skipped = false;
      if (row.meta_lead_id)
        for (const e of events) skipped = (await sendLeadStageEvent({ leadId: row.meta_lead_id, eventName: e === "ShowedUp" ? "Contact" : e, eventId: `${e}:${id}`, valueCents: premium })).skipped;
      else skipped = (await sendOutcomeEvents({ events, eventId: id, email: row.email, phone: row.phone, attribution: row.attribution ?? {}, valueCents: premium })).skipped;
      const sent = [...new Set([...(row.outcome_sent ?? "").split(",").filter(Boolean), ...events])].join(",");
      await supabaseAdmin.from(TABLE[kind]).update({ outcome_sent: sent }).eq("id", id);
      // The timeline only says what Meta actually got (nothing when the Conversions API isn't set up)
      if (!skipped) await logActivity(agentId, subject, "meta", events.map(metaEventLabel).join(", "));
    } catch (e) {
      // The answer is saved either way; the next answer for this lead retries what wasn't sent
      console.error("sending the outcome to Meta failed", e instanceof Error ? e.message : e);
    }
  }
  return true;
}

// ---------- What to ask about ----------

/**
 * The agent's leads from the last ASK_WINDOW_DAYS that have happened: calls whose time has passed, and form
 * leads and quote requests (unless they went on to book, which asks about the call instead). `due` keeps only
 * the unanswered ones. Empty before the outcomes migration.
 */
export async function getOutcomeItems(agent: Pick<Agent, "id">, opts: { due?: boolean; limit?: number } = {}): Promise<OutcomeItem[]> {
  const since = new Date(Date.now() - ASK_WINDOW_DAYS * 86_400_000).toISOString();
  const now = new Date().toISOString();
  let calls = supabaseAdmin.from("bookings").select("id, name, starts_at, outcome, premium_cents").eq("agent_id", agent.id).eq("status", "confirmed").lt("starts_at", now).gte("starts_at", since);
  let leads = supabaseAdmin.from("quote_requests").select("id, name, created_at, outcome, premium_cents, source, booked_at").eq("agent_id", agent.id).gte("created_at", since).lt("created_at", now);
  if (opts.due) {
    calls = calls.is("outcome", null);
    leads = leads.is("outcome", null).is("booked_at", null);
  }
  const [{ data: c, error: ce }, { data: l, error: le }] = await Promise.all([calls, leads]);
  const items: OutcomeItem[] = [];
  if (!ce)
    for (const b of c ?? []) items.push({ kind: "call", id: b.id, name: b.name, at: b.starts_at, outcome: b.outcome, premiumCents: b.premium_cents, source: "booking" });
  if (!le)
    for (const q of l ?? []) items.push({ kind: "lead", id: q.id, name: q.name, at: q.created_at, outcome: q.outcome, premiumCents: q.premium_cents, source: q.source === "instant_form" ? "instant_form" : "page" });
  items.sort((a, b) => b.at.localeCompare(a.at));
  return opts.limit ? items.slice(0, opts.limit) : items;
}

// ---------- Per ad ----------

/** Window for scoring ads on outcomes: outcomes come in slowly, so it's longer than the review's 14 days. */
export const OUTCOME_WINDOW_DAYS = 60;

/**
 * Each ad's booked calls (from its utm_content) with their outcomes over the last OUTCOME_WINDOW_DAYS,
 * unanswered as null. Empty before the outcomes migration.
 */
export async function outcomesByAd(agentId: string) {
  const since = new Date(Date.now() - OUTCOME_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin.from("bookings").select("attribution, outcome").eq("agent_id", agentId).eq("status", "confirmed").gte("created_at", since);
  const map = new Map<string, (string | null)[]>();
  if (error) return map;
  for (const b of data ?? []) {
    const adId = (b.attribution as Record<string, string> | null)?.utm_content;
    if (!adId) continue;
    map.set(adId, [...(map.get(adId) ?? []), (b.outcome as string | null) ?? null]);
  }
  return map;
}

// ---------- The morning ask ----------

const when = (iso: string, tz: string, kind: OutcomeKind) => {
  const d = DateTime.fromISO(iso).setZone(tz);
  return kind === "call" ? `call ${d.toFormat("ccc h:mm a")}` : `came in ${d.toFormat("ccc")}`;
};

// Sold and not interested lead with ✅ and ❌, so the two answers that matter most are easy to spot
const SLACK_LABEL: Record<string, string> = { sold: "✅ Sold", not_interested: "❌ Not interested", tried_call: "📞 Tried to call" };

/**
 * One lead's one-tap buttons for Slack: links (so nothing needs setting up in Slack) to a signed page that
 * saves the answer, updates their card and tells Meta. "Tried to call" logs the attempt (and sends the
 * "sorry I missed you" email when the agent has it on).
 */
export function outcomeButtons(kind: OutcomeKind, id: string, keys?: string[]) {
  const all = [...(kind === "call" ? CALL_OUTCOMES : LEAD_OUTCOMES).map((o) => o.key as string), "tried_call"];
  return {
    type: "actions",
    elements: (keys ?? all).map((key) => ({
      type: "button",
      text: { type: "plain_text", text: SLACK_LABEL[key] ?? outcomeLabel(kind, key), emoji: true },
      url: outcomeUrl(kind, id, key),
      action_id: `outcome_${kind}_${key}_${id}`.slice(0, 255),
    })),
  };
}

/** Their card in the dashboard (Clients), where everything about them can be updated. */
export const clientCardUrl = (kind: OutcomeKind, id: string) => `${appUrl()}/dashboard/clients?id=${kind}:${id}`;

/** A new lead's Slack ping: the message, how to use the buttons, then the buttons the agent taps after calling them. */
export const leadPingBlocks = (text: string, kind: OutcomeKind, id: string) => [
  { type: "section", text: { type: "mrkdwn", text } },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*After you call, tap what happened:* 📞 Tried to call · Reached · ✅ Sold · ❌ Not interested. Their card updates and Meta learns which ads bring buyers. Or <${clientCardUrl(kind, id)}|open their card> to add notes and update them.`,
    },
  },
  outcomeButtons(kind, id, ["tried_call", "reached", "sold", "not_interested"]),
];

/** The Slack message: each lead with its one-tap answers. */
export function outcomeAskMessage(agent: Pick<Agent, "timezone">, items: OutcomeItem[], reminder: boolean) {
  const text = reminder ? "A quick reminder: how did these go?" : `How did ${items.length === 1 ? "this one" : "these"} go? One tap each, and Migz learns which ads bring people who buy.`;
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `✅ Sold and ❌ Not interested update their card and tell Meta. 📞 Tried to call logs the attempt. Or update them in <${appUrl()}/dashboard/clients|Clients>.` }],
    },
  ];
  for (const it of items) {
    blocks.push(
      { type: "section", text: { type: "mrkdwn", text: `*<${clientCardUrl(it.kind, it.id)}|${it.name.replace(/[<>|]/g, "")}>* · ${when(it.at, agent.timezone, it.kind)}${it.source === "instant_form" ? " · instant form" : it.source === "page" ? " · quote request" : ""}` } },
      outcomeButtons(it.kind, it.id),
    );
  }
  return { text, blocks };
}

/**
 * Once a day (from the morning digest cron): asks about leads from before today that were never asked, and
 * reminds once about ones asked REMIND_AFTER_DAYS ago and still unanswered. Nothing to ask, nothing sent.
 */
export async function askOutcomes(agent: Pick<Agent, "id" | "timezone" | "slack_user_id">, now: DateTime = DateTime.now()) {
  if (!agent.slack_user_id || !process.env.SLACK_BOT_TOKEN) return { asked: 0, reminded: 0 };
  const today = now.setZone(agent.timezone).startOf("day").toUTC().toISO()!;
  const remindBefore = now.minus({ days: REMIND_AFTER_DAYS }).toUTC().toISO()!;
  const since = now.minus({ days: ASK_WINDOW_DAYS }).toUTC().toISO()!;
  const pick = async (kind: OutcomeKind, fresh: boolean) => {
    const at = kind === "call" ? "starts_at" : "created_at";
    let q = supabaseAdmin
      .from(TABLE[kind])
      .select(kind === "call" ? "id, name, starts_at, outcome, premium_cents" : "id, name, created_at, outcome, premium_cents, source")
      .eq("agent_id", agent.id)
      .is("outcome", null)
      .lt(at, today)
      .gte(at, since);
    q = kind === "call" ? q.eq("status", "confirmed") : q.is("booked_at", null);
    q = fresh ? q.is("outcome_asked_at", null) : q.lte("outcome_asked_at", remindBefore).is("outcome_reminded_at", null);
    const { data, error } = await q.order(at, { ascending: false }).limit(MAX_IN_SLACK);
    if (error) return [];
    return ((data ?? []) as unknown as Record<string, string | null>[]).map((r) => ({
      kind,
      id: r.id!,
      name: r.name!,
      at: (kind === "call" ? r.starts_at : r.created_at)!,
      outcome: null,
      premiumCents: null,
      source: kind === "call" ? "booking" : r.source === "instant_form" ? "instant_form" : "page",
    })) as OutcomeItem[];
  };
  const fresh = [...(await pick("call", true)), ...(await pick("lead", true))].slice(0, MAX_IN_SLACK);
  const remind = fresh.length ? [] : [...(await pick("call", false)), ...(await pick("lead", false))].slice(0, MAX_IN_SLACK);
  const items = fresh.length ? fresh : remind;
  if (!items.length) return { asked: 0, reminded: 0 };
  const msg = outcomeAskMessage(agent, items, !fresh.length);
  await sendSlackMessage(agent.slack_user_id, msg.text, msg.blocks);
  const stamp = new Date().toISOString();
  for (const kind of ["call", "lead"] as const) {
    const ids = items.filter((i) => i.kind === kind).map((i) => i.id);
    if (ids.length) await supabaseAdmin.from(TABLE[kind]).update(fresh.length ? { outcome_asked_at: stamp } : { outcome_reminded_at: stamp }).in("id", ids);
  }
  return fresh.length ? { asked: items.length, reminded: 0 } : { asked: 0, reminded: items.length };
}

