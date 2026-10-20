import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import type { IntakeAnswers } from "@/lib/booking/questions";

export type DailyMetric = {
  date: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
};

export type ClientBooking = {
  id: string;
  name: string;
  email: string;
  phone: string;
  starts_at: string;
  ends_at: string;
  status: string;
  created_at: string;
  agent_notes: string | null;
  attribution: Record<string, string>;
  answers: IntakeAnswers | null;
  intake_completed: boolean;
};

export type WalletTransaction = {
  id: string;
  kind: string;
  amount_cents: number;
  status: string;
  description: string | null;
  created_at: string;
};

export async function getBalanceCents(agentId: string) {
  const { data } = await supabaseAdmin
    .from("wallet_transactions")
    .select("amount_cents")
    .eq("agent_id", agentId)
    .eq("status", "completed");
  return (data ?? []).reduce((sum, t) => sum + t.amount_cents, 0);
}

export async function getTransactions(agentId: string): Promise<WalletTransaction[]> {
  const { data } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id, kind, amount_cents, status, description, created_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

/** Last `days` days of metrics, one row per day (missing days filled with zeros), oldest first. */
export async function getDailyMetrics(agent: Agent, days = 30): Promise<DailyMetric[]> {
  const today = DateTime.now().setZone(agent.timezone).startOf("day");
  const from = today.minus({ days });

  const { data } = await supabaseAdmin
    .from("ad_metrics_daily")
    .select("date, spend_cents, impressions, clicks, leads")
    .eq("agent_id", agent.id)
    .gte("date", from.toISODate()!)
    .lt("date", today.toISODate()!);

  const byDate = new Map((data ?? []).map((row) => [row.date, row]));
  return Array.from({ length: days }, (_, i) => {
    const date = from.plus({ days: i }).toISODate()!;
    return byDate.get(date) ?? { date, spend_cents: 0, impressions: 0, clicks: 0, leads: 0 };
  });
}

export type MigzAction = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  status: "proposed" | "applied" | "rejected" | "failed" | "expired";
  created_at: string;
  result: { error?: string } | null;
};

export async function getAdActions(agentId: string, limit = 8): Promise<MigzAction[]> {
  const { data } = await supabaseAdmin
    .from("ad_actions")
    .select("id, kind, title, detail, status, created_at, result")
    .eq("agent_id", agentId)
    .neq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as MigzAction[];
}

export async function getProposedActions(agentId: string): Promise<MigzAction[]> {
  const { data } = await supabaseAdmin
    .from("ad_actions")
    .select("id, kind, title, detail, status, created_at, result")
    .eq("agent_id", agentId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false });
  return (data ?? []) as MigzAction[];
}

type BookingRow = Omit<ClientBooking, "answers" | "intake_completed"> & {
  intake_responses: { answers: IntakeAnswers; completed_at: string | null } | { answers: IntakeAnswers; completed_at: string | null }[] | null;
};

function toClient(row: BookingRow): ClientBooking {
  const intake = Array.isArray(row.intake_responses) ? row.intake_responses[0] : row.intake_responses;
  const { intake_responses: _ignored, ...rest } = row;
  void _ignored;
  return {
    ...rest,
    answers: intake?.answers && Object.keys(intake.answers).length ? intake.answers : null,
    intake_completed: !!intake?.completed_at,
  };
}

const BOOKING_FIELDS =
  "id, name, email, phone, starts_at, ends_at, status, created_at, agent_notes, attribution, intake_responses(answers, completed_at)";

export async function getBookingsBetween(agentId: string, fromIso: string, toIso: string) {
  const { data } = await supabaseAdmin
    .from("bookings")
    .select(BOOKING_FIELDS)
    .eq("agent_id", agentId)
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at");
  return ((data ?? []) as BookingRow[]).map(toClient);
}

export async function getUpcomingBookings(agentId: string, limit = 5) {
  const { data } = await supabaseAdmin
    .from("bookings")
    .select(BOOKING_FIELDS)
    .eq("agent_id", agentId)
    .eq("status", "confirmed")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(limit);
  return ((data ?? []) as BookingRow[]).map(toClient);
}

export async function getAllClients(agentId: string) {
  const { data } = await supabaseAdmin
    .from("bookings")
    .select(BOOKING_FIELDS)
    .eq("agent_id", agentId)
    .order("starts_at", { ascending: false })
    .limit(500);
  return ((data ?? []) as BookingRow[]).map(toClient);
}
