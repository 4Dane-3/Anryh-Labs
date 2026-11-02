import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { OutcomeKind } from "@/lib/outcomes";

// The timeline on each client's card. The agent's own entries (a call attempt, a voicemail, a text, a note)
// can be edited or deleted; the system's (emails sent, outcomes, status changes, what Meta was told) are the
// record. Writing one never fails the thing it records: before the client-cards migration it's a no-op.

export type ActivityKind = "tried_call" | "voicemail" | "texted" | "note" | "outcome" | "status" | "email" | "meta";
/** What the agent can log themselves. */
export const AGENT_ACTIVITY_KINDS = ["tried_call", "voicemail", "texted", "note"] as const;
export type AgentActivityKind = (typeof AGENT_ACTIVITY_KINDS)[number];
export const isAgentActivityKind = (v: unknown): v is AgentActivityKind => AGENT_ACTIVITY_KINDS.includes(v as AgentActivityKind);

export type Subject = { kind: OutcomeKind; id: string };

export async function logActivity(agentId: string, subject: Subject, kind: ActivityKind, body: string | null, opts: { byAgent?: boolean; at?: string } = {}) {
  const { error } = await supabaseAdmin.from("client_activities").insert({
    agent_id: agentId,
    subject_kind: subject.kind,
    subject_id: subject.id,
    kind,
    body: body?.slice(0, 2000) || null,
    by_agent: !!opts.byAgent,
    ...(opts.at ? { at: opts.at } : {}),
  });
  if (error) console.error("logging client activity failed", error.message);
}
