import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { carryOver, type Phase, type Thought } from "@/lib/migz/nightly-core";

/** Migz's latest notebook (from the most recent nightly summary), or null before the first one. */
export async function latestNotebook(agentId: string) {
  const { data, error } = await supabaseAdmin
    .from("nightly_summaries")
    .select("local_date, phase, thoughts, narrative, slack_sent_at")
    .eq("agent_id", agentId)
    .order("local_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    date: data.local_date as string,
    phase: data.phase as Phase,
    headline: ((data.narrative as { headline?: string } | null)?.headline ?? "") as string,
    thoughts: (data.thoughts ?? []) as Thought[],
    sentToSlack: !!data.slack_sent_at,
  };
}

/** What a review reads: the thoughts still being worked on, with how long Migz has carried each. */
export async function notebookForReview(agentId: string) {
  const nb = await latestNotebook(agentId);
  if (!nb) return "none yet";
  const active = carryOver(nb.thoughts);
  return {
    as_of: nb.date,
    note: "Your running thoughts from the nightly summaries. 'ready' means the data backed it and you meant to act as soon as you're allowed; act on those when the results phase is over, if the numbers still agree, and say so. 'testing' and 'considering' need more evidence. Don't act on a thought the current numbers contradict.",
    thoughts: active.map((t) => ({ id: t.id, thought: t.text, kind: t.kind, status: t.status, nights_carried: t.nights, since: t.since, latest_note: t.note })),
  };
}
