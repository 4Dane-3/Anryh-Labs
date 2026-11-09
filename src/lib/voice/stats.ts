import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { median } from "@/lib/voice/rules";

export type SpeedToLead = {
  calls: number;
  /** Website quote form: submit → the call request leaving our server */
  submitToRequestMs: number | null;
  /** Any lead: made → the lead picking up (Meta's delay included for instant forms) */
  submitToAnswerMs: number | null;
  /** Instant forms: Meta's created_time → the webhook reaching us */
  metaDelayMs: number | null;
};

/** Speed to lead over the last 30 days, from each lead's first instant call. Null before the voice migration. */
export async function getSpeedToLead(days = 30): Promise<SpeedToLead | null> {
  const { data, error } = await supabaseAdmin
    .from("voice_calls")
    .select("requested_at, answered_at, quote_requests(created_at, received_at, source)")
    .eq("reason", "instant")
    .eq("attempt", 1)
    .gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .limit(5000);
  if (error) return null;
  const toRequest: number[] = [];
  const toAnswer: number[] = [];
  const meta: number[] = [];
  for (const c of data ?? []) {
    const lead = c.quote_requests as unknown as { created_at: string; received_at: string | null; source: string } | null;
    if (!lead) continue;
    const t = (s: string) => new Date(s).getTime();
    const made = lead.source === "instant_form" ? t(lead.created_at) : t(lead.received_at ?? lead.created_at);
    if (lead.source !== "instant_form") toRequest.push(t(c.requested_at) - made);
    if (lead.source === "instant_form" && lead.received_at) meta.push(t(lead.received_at) - t(lead.created_at));
    if (c.answered_at) toAnswer.push(t(c.answered_at) - made);
  }
  return { calls: data?.length ?? 0, submitToRequestMs: median(toRequest), submitToAnswerMs: median(toAnswer), metaDelayMs: median(meta) };
}
