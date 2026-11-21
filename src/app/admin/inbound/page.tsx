import { supabaseAdmin } from "@/lib/supabase-admin";
import { inboundConfigured, inboundConfiguredFor } from "@/lib/voice/elevenlabs";
import { PageHead } from "@/components/admin/AdminShell";
import { InboundNumbers, type InboundRow } from "@/components/admin/InboundNumbers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbound calls · Admin" };

// Roofers who opted in to inbound Emma, the number each one is answered on, and their last 30 days of calls.
export default async function InboundPage() {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, full_name, inbound_mode, inbound_number, inbound_transfer_number")
    .eq("inbound_calls", true)
    .order("full_name");
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: calls } = error ? { data: [] } : await supabaseAdmin.from("inbound_calls").select("agent_id, outcome, duration_secs").gte("created_at", since);
  const stats = new Map<string, { calls: number; booked: number; minutes: number }>();
  for (const c of (calls ?? []) as { agent_id: string; outcome: string | null; duration_secs: number | null }[]) {
    const s = stats.get(c.agent_id) ?? { calls: 0, booked: 0, minutes: 0 };
    s.calls++;
    if (c.outcome === "booked") s.booked++;
    s.minutes += (c.duration_secs ?? 0) / 60;
    stats.set(c.agent_id, s);
  }
  const rows: InboundRow[] = ((data ?? []) as { id: string; full_name: string; inbound_mode: string | null; inbound_number: string | null; inbound_transfer_number: string | null }[]).map((a) => ({
    ...a,
    ...(stats.get(a.id) ?? { calls: 0, booked: 0, minutes: 0 }),
  }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <PageHead
        eyebrow="Voice"
        title="Inbound calls"
        description="Roofers and clinics who turned on inbound Emma (+$250/month). Buy a Twilio number for each, import it into ElevenLabs, assign it to Emma (Inbound) for a roofer or Emma (Clinic Inbound) for a clinic, then enter it here."
      />
      {!inboundConfigured() && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">ELEVENLABS_INBOUND_AGENT_ID isn&apos;t set on this server, so roofers&apos; inbound calls can&apos;t be answered yet.</p>}
      {!inboundConfiguredFor("hair_clinic") && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">ELEVENLABS_CLINIC_INBOUND_AGENT_ID isn&apos;t set on this server, so clinics&apos; inbound calls can&apos;t be answered yet.</p>}
      {error ? (
        <p className="text-sm text-fg-muted">Run migration 20261218000000_inbound_calls.sql first.</p>
      ) : (
        <InboundNumbers rows={rows} />
      )}
    </div>
  );
}
