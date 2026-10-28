import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { carryOver, SUMMARY_EVERY_DAYS, type Phase, type Thought } from "@/lib/migz/nightly-core";

/** A notebook older than one summary cycle (plus a day of slack) is out of date. */
const NOTEBOOK_STALE_DAYS = SUMMARY_EVERY_DAYS + 1;

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
  const daysOld = Math.max(0, Math.round((Date.now() - Date.parse(`${nb.date}T21:00:00`)) / 86_400_000));
  return {
    as_of: nb.date,
    days_old: daysOld,
    ...(daysOld > NOTEBOOK_STALE_DAYS ? { stale: `Written ${daysOld} days ago, before the latest results: treat every thought as unconfirmed until the current snapshot backs it.` } : {}),
    note: "Your running thoughts from the summaries, as of as_of. Every number in them is from then, not now. 'ready' means the data backed it and you meant to act as soon as you're allowed; act on those when the results phase is over, if the numbers still agree, and say so. 'testing' and 'considering' need more evidence. Don't act on a thought the current numbers contradict.",
    thoughts: active.map((t) => ({ id: t.id, thought: t.text, kind: t.kind, status: t.status, nights_carried: t.nights, since: t.since, latest_note: t.note })),
  };
}
