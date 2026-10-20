import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  generateSlots,
  type AvailabilityRule,
  type SlotConfig,
} from "@/lib/booking/slots";

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
