import type { Metadata } from "next";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { GlassBackdrop } from "@/components/glass/GlassBackdrop";
import { OneTapOutcome } from "@/components/dashboard/OutcomeAsk";
import { validSignature } from "@/lib/dashboard/outcomes";
import type { OutcomeKind } from "@/lib/outcomes";

export const metadata: Metadata = { title: "How did it go? · Migz AI", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where the Slack ask's buttons land: saves the tapped answer and lets the agent change it or add the premium. */
export default async function OutcomePage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ r?: string; s?: string }> }) {
  const { kind: rawKind, id } = await params;
  const { r, s } = await searchParams;
  const kind: OutcomeKind | null = rawKind === "call" || rawKind === "lead" ? rawKind : null;
  const ok = !!kind && validSignature(kind, id, s ?? null);
  const row = ok
    ? (
        await supabaseAdmin
          .from(kind === "call" ? "bookings" : "quote_requests")
          .select(kind === "call" ? "name, starts_at, outcome, agents(timezone)" : "name, created_at, outcome, agents(timezone)")
          .eq("id", id)
          .maybeSingle()
      ).data as unknown as { name: string; starts_at?: string; created_at?: string; outcome?: string | null; agents: { timezone: string } | null } | null
    : null;
  const tz = row?.agents?.timezone ?? "America/Chicago";
  const at = row ? DateTime.fromISO((row.starts_at ?? row.created_at)!).setZone(tz).toFormat("cccc, LLL d 'at' h:mm a") : "";

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink px-4 text-fg [color-scheme:dark]">
      <GlassBackdrop tone="dim" />
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-ink-raised px-6 py-6 backdrop-blur-xl">
        {row && kind ? (
          <OneTapOutcome kind={kind} id={id} sig={s!} name={row.name} when={kind === "call" ? `Call on ${at}` : `Came in ${at}`} tapped={r ?? null} current={row.outcome ?? null} />
        ) : (
          <p className="text-sm text-fg-muted">This link isn&apos;t valid any more. Open your dashboard to answer from there.</p>
        )}
      </div>
    </div>
  );
}
