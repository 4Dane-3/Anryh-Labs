import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  generateSlots,
  type AvailabilityRule,
  type SlotConfig,
} from "@/lib/booking/slots";
import { DEFAULT_QUESTIONS, type IntakeQuestion } from "@/lib/booking/questions";

export type Agent = {
  id: string;
  slug: string;
  full_name: string;
  headline: string | null;
  bio: string | null;
  photo_url: string | null;
  license_number: string | null;
  licensed_states: string[];
  email: string;
  timezone: string;
  slot_minutes: number;
  buffer_minutes: number;
  min_notice_hours: number;
  max_days_ahead: number;
  slack_user_id: string | null;
  digest_hour: number;
  last_digest_date: string | null;
  user_id: string | null;
  daily_budget_cents: number;
  ads_paused: boolean;
  meta_ad_account_id: string | null;
  meta_page_id: string | null;
  meta_instagram_id: string | null;
  migz_mode: "off" | "approve" | "auto";
  migz_last_run_at: string | null;
  migz_model_budget_cents: number;
  migz_last_operator_at: string | null;
  migz_last_daily_at: string | null;
  migz_last_fatigue_at: string | null;
  migz_last_weekly_at: string | null;
  migz_gate_state: unknown;
  ad_focus?: string[]; // topic keys, most important first (missing before the ad_focus migration)
  title?: string | null; // job title on the booking page (null = default)
  campaign_days?: number | null;
  campaign_started_on?: string | null;
  campaign_ends_on?: string | null;
  creative_mode?: "upload" | "ai" | "both" | null;
  onboarding_completed_at?: string | null;
  required_intake_steps?: number[]; // steps whose questions must be answered before booking
};

export type Booking = {
  id: string;
  agent_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  name: string;
  email: string;
  phone: string;
  token: string;
  agent_notes: string | null;
};

export async function getAgentBySlug(slug: string): Promise<Agent | null> {
  const { data } = await supabaseAdmin
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  return data;
}

export async function getBookingByToken(
  token: string,
): Promise<(Booking & { agents: Agent }) | null> {
  // Tokens are uuids; anything else would make Postgres throw
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await supabaseAdmin
    .from("bookings")
    .select("*, agents(*)")
    .eq("token", token)
    .eq("status", "confirmed")
    .maybeSingle();
  return data;
}

export async function getOpenSlots(agent: Agent): Promise<string[]> {
  const horizon = new Date(Date.now() + (agent.max_days_ahead + 2) * 86_400_000);

  const [rulesRes, busyRes] = await Promise.all([
    supabaseAdmin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("agent_id", agent.id),
    supabaseAdmin
      .from("bookings")
      .select("starts_at, ends_at")
      .eq("agent_id", agent.id)
      .eq("status", "confirmed")
      .gte("ends_at", new Date().toISOString())
      .lte("starts_at", horizon.toISOString()),
  ]);

  const rules: AvailabilityRule[] = rulesRes.data ?? [];
  const busy = (busyRes.data ?? []).map((b) => ({
    start: new Date(b.starts_at),
    end: new Date(b.ends_at),
  }));

  const config: SlotConfig = {
    timezone: agent.timezone,
    slotMinutes: agent.slot_minutes,
    bufferMinutes: agent.buffer_minutes,
    minNoticeHours: agent.min_notice_hours,
    maxDaysAhead: agent.max_days_ahead,
  };

  return generateSlots(rules, busy, config);
}

/** The agent's questions (enabled and disabled), or the defaults if they've never edited them. */
export async function getIntakeQuestions(agentId: string): Promise<IntakeQuestion[]> {
  const columns = "key, step, sort, label, kind, options, allow_other, placeholder, hidden_when_key, hidden_when_value, enabled";
  const query = (cols: string) =>
    supabaseAdmin.from("intake_questions").select(cols).eq("agent_id", agentId).order("step").order("sort");
  let { data, error } = await query(`${columns}, required`);
  // Before the required-questions migration: the agent's own questions, none required
  if (error) ({ data, error } = await query(columns));
  if (!data?.length) return DEFAULT_QUESTIONS;
  return (data as unknown as IntakeQuestion[]).map((q) => ({ ...q, required: q.required ?? false }));
}
