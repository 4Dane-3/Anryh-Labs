import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { addDays, evaluateGuarantee, GUARANTEE_DAYS, openHoursPerWeek, targetFor } from "@/lib/guarantee";
import { alertAdmin } from "@/lib/migz/slack";

// The booked-call guarantee's records (guarantee.ts has the rules). One starts when an agent's campaign launches;
// the hourly run settles it the day after its 30th day. A miss is flagged to staff, and an approved refund
// credits the Anryh Labs fee back to the agent's ad balance (once: the wallet row is keyed by the guarantee).

export type GuaranteeRow = {
  id: string;
  agent_id: string;
  starts_on: string;
  ends_on: string;
  daily_cents: number;
  target: number;
  status: "running" | "met" | "missed" | "ineligible" | "refunded" | "declined";
  bookings: number | null;
  fee_cents: number | null;
  unmet: string[];
  evaluated_at: string | null;
  decided_at: string | null;
};

const COLS = "id, agent_id, starts_on, ends_on, daily_cents, target, status, bookings, fee_cents, unmet, evaluated_at, decided_at";
const todayFor = (agent: Pick<Agent, "timezone">) => DateTime.now().setZone(agent.timezone).toISODate()!;

/** Starts the guarantee when the agent's first campaign launches (no-op before its migration or if one exists). */
export async function startGuarantee(agent: Agent) {
  const startsOn = todayFor(agent);
  const daily = agent.daily_budget_cents;
  const { error } = await supabaseAdmin
    .from("booking_guarantees")
    .insert({ agent_id: agent.id, starts_on: startsOn, ends_on: addDays(startsOn, GUARANTEE_DAYS - 1), daily_cents: daily, target: targetFor(daily) });
  if (error && error.code !== "23505") console.error("starting the booking guarantee failed", error.message);
}

/** Everything the rules need about one guarantee, read now (up to its end once it's over). */
async function gather(agent: Agent, g: GuaranteeRow) {
  const today = todayFor(agent);
  const zone = agent.timezone;
  const from = DateTime.fromISO(g.starts_on, { zone }).startOf("day").toUTC().toISO()!;
  const until = DateTime.fromISO(g.ends_on, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!;
  const lastSpendDay = today > g.ends_on ? g.ends_on : addDays(today, -1);
  const [bookings, wallet, spend, hours] = await Promise.all([
    supabaseAdmin.from("bookings").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).neq("status", "cancelled").gte("created_at", from).lt("created_at", until),
    // Ad money added: deposits after their fee, less refunds (with the fee returned on them), up to the end
    supabaseAdmin.from("wallet_transactions").select("kind, amount_cents").eq("agent_id", agent.id).in("kind", ["deposit", "fee", "refund"]).eq("status", "completed").lt("created_at", until),
    supabaseAdmin.from("ad_metrics_daily").select("date").eq("agent_id", agent.id).gt("spend_cents", 0).gte("date", g.starts_on).lte("date", lastSpendDay),
    supabaseAdmin.from("availability_rules").select("start_time, end_time").eq("agent_id", agent.id),
  ]);
  const rows = wallet.data ?? [];
  const sum = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount_cents, 0);
  const evaluation = evaluateGuarantee({
    startsOn: g.starts_on,
    endsOn: g.ends_on,
    today,
    dailyCents: g.daily_cents,
    target: g.target,
    bookings: bookings.count ?? 0,
    adFundsAddedCents: sum("deposit") + sum("fee") + sum("refund"),
    spendDays: new Set((spend.data ?? []).map((r) => r.date)).size,
    ownBookingPage: agent.booking_choice === "own",
    openHours: openHoursPerWeek(hours.data ?? []),
    migzOff: agent.migz_mode === "off",
  });
  return { evaluation, bookings: bookings.count ?? 0, feeCents: Math.max(0, -sum("fee")) };
}

/** The agent's current guarantee and where it stands, for the dashboard. Null when they don't have one. */
export async function getGuarantee(agent: Agent) {
  const { data, error } = await supabaseAdmin.from("booking_guarantees").select(COLS).eq("agent_id", agent.id).order("starts_on", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  const g = data as GuaranteeRow;
  const live = await gather(agent, g);
  return { row: g, ...live };
}

/** The hourly run: settles every guarantee whose 30 days are over. A miss is flagged to staff for the refund. */
export async function settleGuarantees() {
  const { data, error } = await supabaseAdmin.from("booking_guarantees").select(COLS).eq("status", "running").lt("ends_on", DateTime.utc().toISODate()!);
  if (error) return 0;
  let settled = 0;
  for (const g of (data ?? []) as GuaranteeRow[]) {
    const { data: agent } = await supabaseAdmin.from("agents").select("*").eq("id", g.agent_id).maybeSingle();
    if (!agent) continue;
    const { evaluation, bookings, feeCents } = await gather(agent as Agent, g);
    if (!evaluation.done) continue; // not over in the agent's own timezone yet
    const { data: saved } = await supabaseAdmin
      .from("booking_guarantees")
      .update({ status: evaluation.status, bookings, fee_cents: feeCents, unmet: evaluation.unmet, evaluated_at: new Date().toISOString() })
      .eq("id", g.id)
      .eq("status", "running")
      .select("id");
    if (!saved?.length) continue;
    settled++;
    if (evaluation.status === "missed")
      await alertAdmin(`Booked-call guarantee missed for ${(agent as Agent).full_name}: ${bookings} of ${g.target} booked calls in 30 days. Refund of the $${(feeCents / 100).toFixed(2)} fee is waiting for your approval in Admin.`);
  }
  return settled;
}

/** Staff decide a missed guarantee: approve credits the fee back to the agent's ad balance (once), or decline. */
export async function decideGuarantee(id: string, approve: boolean, staff: string) {
  const { data } = await supabaseAdmin.from("booking_guarantees").select(COLS).eq("id", id).maybeSingle();
  const g = data as GuaranteeRow | null;
  if (!g || g.status !== "missed") return { ok: false as const, error: "Only a missed guarantee can be decided." };
  if (approve && (g.fee_cents ?? 0) > 0) {
    const { error } = await supabaseAdmin.from("wallet_transactions").insert({
      agent_id: g.agent_id,
      kind: "adjustment",
      amount_cents: g.fee_cents,
      status: "completed",
      description: `Booked-call guarantee: Anryh Labs fee credited back (${g.bookings ?? 0} of ${g.target} booked calls)`,
      external_id: `guarantee:${g.id}`,
    });
    if (error && error.code !== "23505") return { ok: false as const, error: "Couldn't credit the fee." };
  }
  await supabaseAdmin
    .from("booking_guarantees")
    .update({ status: approve ? "refunded" : "declined", decided_at: new Date().toISOString(), decided_by: staff })
    .eq("id", g.id)
    .eq("status", "missed");
  return { ok: true as const };
}

/** Guarantees waiting on staff, for the admin page. */
export async function getMissedGuarantees() {
  const { data } = await supabaseAdmin.from("booking_guarantees").select(`${COLS}, agents(full_name, slug)`).eq("status", "missed").order("ends_on", { ascending: true });
  return (data ?? []) as unknown as (GuaranteeRow & { agents: { full_name: string; slug: string } | null })[];
}
