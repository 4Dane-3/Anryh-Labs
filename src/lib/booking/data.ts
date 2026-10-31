import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  generateSlots,
  withGhostHolds,
  type AvailabilityRule,
  type SlotConfig,
} from "@/lib/booking/slots";
import { DEFAULT_QUESTIONS, type IntakeQuestion } from "@/lib/booking/questions";
import type { QuoteMode } from "@/lib/booking/constants";

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
  slot_interval_minutes?: number | null; // start-time spacing (null = the call length); missing before its migration
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
  migz_run_claimed_at?: string | null; // a review is running (missing before the run-safety migration)
  migz_failed_at?: string | null; // last failed review; scheduled reviews back off
  migz_fail_count?: number;
  ad_focus?: string[]; // topic keys, most important first (missing before the ad_focus migration)
  title?: string | null; // job title on the booking page (null = default)
  campaign_days?: number | null;
  campaign_started_on?: string | null;
  campaign_ends_on?: string | null;
  creative_mode?: "upload" | "ai" | "both" | null;
  onboarding_completed_at?: string | null;
  required_intake_steps?: number[]; // steps whose questions must be answered before booking
  stripe_customer_id?: string | null; // saved from the first paid deposit
  page_font?: string; // booking page font key (see lib/booking/page-fonts.ts); missing before its migration
  ghost_bookings?: boolean; // hold back some open times so the calendar looks busy (missing before its migration)
  call_button?: boolean; // "Call now" on the booking page (missing before its migration)
  call_phone?: string | null; // E.164, the number that button dials
  call_hours_only?: boolean; // show it only during working hours
  results_from?: string | null; // results before this date aren't comparable (placements changed); missing before its migration
  ad_logo_path?: string | null; // the agent's transparent logo (creatives bucket), on Migz ads and as their end card; missing before its migration
  ad_logo_corner?: "top_left" | "top_right" | "bottom_left" | "bottom_right"; // where the small logo sits; missing before its migration
  quote_mode?: QuoteMode; // "Get a free quote" on the booking page (missing before its migration)
  intent_level?: "low_medium" | "medium_high"; // low_medium also runs Meta instant forms (missing before its migration)
  video_tier?: "standard" | "seedance_15" | "seedance_30"; // Seedance tiers are charged per video (missing before its migration)
  partner_carriers?: string[] | null; // the insurance companies shown on their page; missing before its migration, null until they set it
  campaign_answers?: unknown; // the start flow's answers (campaign-plan cleanAnswers); missing before its migration
  meta_lead_form_id?: string | null; // the instant form Migz made on the agent's Page
  lead_form_blocked?: string | null; // why making that form last failed
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
  return (await getSlotBoard(agent)).open;
}

/**
 * Every time the booking page shows: `open` can be booked; `taken` are times inside the agent's hours
 * that are already booked (or held back by ghost bookings), shown greyed out so the calendar reads as
 * a real, busy one. Both are UTC ISO strings, ascending.
 */
export async function getSlotBoard(agent: Agent): Promise<{ open: string[]; taken: string[] }> {
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
    intervalMinutes: agent.slot_interval_minutes ?? null,
    bufferMinutes: agent.buffer_minutes,
    minNoticeHours: agent.min_notice_hours,
    maxDaysAhead: agent.max_days_ahead,
  };

  const free = generateSlots(rules, busy, config);
  const open = agent.ghost_bookings ? withGhostHolds(free, agent.id, agent.timezone) : free;
  const openSet = new Set(open);
  const taken = generateSlots(rules, [], config).filter((t) => !openSet.has(t));
  return { open, taken };
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
