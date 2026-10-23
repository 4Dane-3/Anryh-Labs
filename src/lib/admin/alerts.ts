import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Severity } from "@/lib/admin/issues";

// Kept apart from health.ts (the scanner) so the Slack alert helpers can record alerts without pulling
// in the whole scanner.

/**
 * Records a failure Migz reported as it happened (it has already pinged Slack). Best effort, and a no-op
 * before the migration runs.
 */
export async function recordEventAlert(input: { agentId: string | null; key: string; severity: Severity; title: string; detail: string }) {
  try {
    const now = new Date().toISOString();
    const key = `event:${input.key}`.slice(0, 300);
    const { data: open } = await supabaseAdmin.from("admin_alerts").select("id").eq("key", key).is("resolved_at", null).maybeSingle();
    if (open) {
      await supabaseAdmin.from("admin_alerts").update({ last_seen: now, detail: input.detail.slice(0, 1000) }).eq("id", open.id);
      return;
    }
    await supabaseAdmin.from("admin_alerts").insert({
      agent_id: input.agentId,
      key,
      source: "event",
      severity: input.severity,
      title: input.title.slice(0, 200),
      detail: input.detail.slice(0, 1000),
      slack_sent_at: now,
    });
  } catch {
    // alerts are best effort
  }
}
