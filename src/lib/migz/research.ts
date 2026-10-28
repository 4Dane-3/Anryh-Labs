import "server-only";
import { DateTime } from "luxon";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Agent } from "@/lib/booking/data";
import { begin } from "@/lib/migz/events";
import { callModel, defaultCreateMessage, jsonOf, monthlyBudget, planTier, textOf, type CreateMessage } from "@/lib/migz/router";
import { cleanFocus, TOPICS, type TopicKey } from "@/lib/migz/topics";
import { RESEARCH_KIND } from "@/lib/migz/brain-types";

// The research shift: around the clock, Migz's Haiku crew studies what wins this agent's kind of client
// and works out the next creative to make. Each 10-minute tick moves one cycle forward one step, so the
// Brain always has real work in flight:
//   market (scout)   studies one angle for one of the agent's topics: buyer psychology, hooks, other
//                    agents' ads, trust, timing... (web search every other cycle; between, it reasons
//                    over what's already been gathered)
//   history          checks that against what this account has actually learned and what its ads did
//   clerk            drafts the next creative idea and checks it against Meta's financial-ad rules
//   memory           files it; a batch's setup review reads the latest ideas when it makes new creatives
//                    (ideas stay in the dashboard; they aren't sent to Slack)
// Cost-capped per agent per day, and it stops near the month's AI budget (like the weekly scout).

export const RESEARCH_DAILY_USD = Number(process.env.MIGZ_RESEARCH_DAILY_USD || 0.4);
const RESEARCH_TASKS = ["scout", "librarian", "copy_check"];

export const ANGLES = [
  { key: "buyer psychology", ask: "what makes people decide to book a call about {topic}, and what stops them: the worries, objections and the moment they finally act" },
  { key: "winning hooks", ask: "opening lines and first-three-second visuals that stop the scroll in {topic} ads on Facebook and Instagram" },
  { key: "other agents' ads", ask: "what life insurance agents and insurers are running for {topic} right now, from public sources and ad roundups" },
  { key: "trust without claims", ask: "how {topic} ads earn trust without promises: a real local agent, plain language, transparency, social proof" },
  { key: "life moments", ask: "the life events and seasons that make people think about {topic}, and how an ad can meet that moment" },
  { key: "the free call offer", ask: "how to frame a free call about {topic} so it feels low-pressure and worth booking" },
  { key: "who buys", ask: "who actually buys {topic} (family situations, money worries, how they talk about it), to write for them without calling out personal attributes" },
  { key: "formats", ask: "which formats (short video story, carousel, still image with text) work best for {topic} ads, and why" },
] as const;

type Note = {
  id: number;
  agent_id: string;
  stage: "studying" | "comparing" | "drafting" | "saving" | "done" | "failed";
  topic: string;
  angle: string;
  web: boolean;
  finding: string | null;
  sources: { title: string; url: string }[];
  history: string | null;
  fit: "strong" | "maybe" | "weak" | null;
  idea: Idea | null;
  compliance: string | null;
};
export type Idea = { format: "video" | "image" | "carousel"; hook_line: string; concept: string; why: string };

/** Which topic and angle the next cycle studies: walks the agent's focus and the angles in turn. Pure. */
export function nextAssignment(focus: TopicKey[], cyclesSoFar: number) {
  const topics: TopicKey[] = focus.length ? focus : ["mortgage_protection", "final_expense"];
  const topic = topics[cyclesSoFar % topics.length];
  const angle = ANGLES[Math.floor(cyclesSoFar / topics.length) % ANGLES.length];
  return { topic, angle, web: cyclesSoFar % 2 === 0 };
}

const BASE = `You are on Migz AI's ad team, which runs Meta (Facebook and Instagram) ads that book free calls for an independent US life insurance agent. Be concrete and plain. Never invent statistics or sources. Meta's financial-products rules apply to anything that could become an ad: no guarantees, no implied approval, no prices or returns, and never call out age, health or other personal attributes.`;

const STUDY_SCHEMA = {
  type: "object",
  properties: {
    finding: { type: "string", description: "What you learned, at most 90 words, specific enough to shape an ad" },
    sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, required: ["title", "url"], additionalProperties: false } },
  },
  required: ["finding", "sources"],
  additionalProperties: false,
};
const COMPARE_SCHEMA = {
  type: "object",
  properties: {
    history: { type: "string", description: "How this fits what the account has learned and what its ads did, at most 50 words" },
    fit: { type: "string", enum: ["strong", "maybe", "weak"] },
  },
  required: ["history", "fit"],
  additionalProperties: false,
};
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["video", "image", "carousel"] },
    hook_line: { type: "string", description: "The opening line, at most 12 words" },
    concept: { type: "string", description: "What the ad shows, at most 40 words" },
    why: { type: "string", description: "Why it should win, at most 30 words" },
    compliance: { type: "string", description: "\"ok\", or what would break Meta's financial-ad rules" },
  },
  required: ["format", "hook_line", "concept", "why", "compliance"],
  additionalProperties: false,
};

async function update(id: number, patch: Record<string, unknown>) {
  await supabaseAdmin.from("research_notes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Today's research spend for an agent (its model calls outside a review). */
async function spentToday(agent: Agent) {
  const since = DateTime.now().setZone(agent.timezone).startOf("day").toUTC().toISO()!;
  const { data } = await supabaseAdmin.from("model_calls").select("cost_usd").eq("agent_id", agent.id).is("run_id", null).in("task", RESEARCH_TASKS).gte("created_at", since);
  return (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
}

const label = (topic: string) => (TOPICS as Record<string, { label: string }>)[topic]?.label ?? topic;
const ev = (extra: Record<string, unknown> = {}) => ({ kind: RESEARCH_KIND, ...extra });

/** One research step for one agent. Returns what happened. */
export async function researchTick(agent: Agent, createMessage: CreateMessage = defaultCreateMessage) {
  if (!agent.onboarding_completed_at || agent.migz_mode === "off") return "off";
  const { data: run } = await supabaseAdmin.from("migz_runs").select("status, started_at").eq("agent_id", agent.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (run?.status === "running" && Date.now() - new Date(run.started_at).getTime() < 10 * 60_000) return "review_running";

  const [budget, today] = await Promise.all([monthlyBudget(agent.id, agent.migz_model_budget_cents ?? 3000, agent.timezone), spentToday(agent)]);
  const plan = planTier("scout", budget); // null near the month's budget: research is the most optional work
  if (!plan) return "budget";
  if (today >= RESEARCH_DAILY_USD) return "daily_cap";

  const { data: open } = await supabaseAdmin.from("research_notes").select("*").eq("agent_id", agent.id).not("stage", "in", "(done,failed)").order("id", { ascending: false }).limit(1).maybeSingle();
  let note = open as Note | null;
  if (!note) {
    const { count } = await supabaseAdmin.from("research_notes").select("id", { count: "exact", head: true }).eq("agent_id", agent.id);
    const a = nextAssignment(cleanFocus(agent.ad_focus ?? []), count ?? 0);
    const { data: created, error } = await supabaseAdmin.from("research_notes").insert({ agent_id: agent.id, topic: a.topic, angle: a.angle.key, web: a.web }).select("*").single();
    if (error || !created) return "no_table";
    note = created as Note;
  }

  try {
    if (note.stage === "studying") return await study(agent, note, createMessage);
    if (note.stage === "comparing") return await compare(agent, note, createMessage);
    if (note.stage === "drafting") return await draft(agent, note, createMessage);
    if (note.stage === "saving") return await save(agent, note);
  } catch (e) {
    await update(note.id, { stage: "failed" });
    console.error("research step failed", agent.slug, e instanceof Error ? e.message : e);
    return "failed";
  }
  return note.stage;
}

async function study(agent: Agent, note: Note, createMessage: CreateMessage) {
  const angle = ANGLES.find((a) => a.key === note.angle) ?? ANGLES[0];
  const ask = angle.ask.replace("{topic}", label(note.topic).toLowerCase());
  const done = await begin({ agentId: agent.id, runId: null, step: "researching", tier: "haiku", summary: `Studying ${note.angle} for ${label(note.topic).toLowerCase()}${note.web ? " (searching the web)" : ""}`, evidence: ev() });
  let saved: string[] = [];
  if (!note.web) {
    // Between web cycles: reason over what's already been gathered (the swipe file and past findings)
    const [{ data: swipes }, { data: past }] = await Promise.all([
      supabaseAdmin.from("swipe_files").select("notes").or(`agent_id.is.null,agent_id.eq.${agent.id}`).order("created_at", { ascending: false }).limit(6),
      supabaseAdmin.from("research_notes").select("finding").eq("agent_id", agent.id).eq("stage", "done").order("id", { ascending: false }).limit(4),
    ]);
    saved = [...(swipes ?? []).map((s) => s.notes ?? ""), ...(past ?? []).map((p) => p.finding ?? "")].filter(Boolean);
  }
  const res = await callModel({
    task: "scout",
    tier: "haiku",
    agentId: agent.id,
    runId: null,
    createMessage,
    params: {
      // Room for the search results' summary and the note (1,500 ran out while it listed sources)
      max_tokens: 4000,
      output_config: note.web ? { effort: "low" } : { effort: "low", format: { type: "json_schema", schema: STUDY_SCHEMA } },
      ...(note.web ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] } : {}),
      system: [{ type: "text", text: `${BASE}\n\nYou are the market scout. ${note.web ? "Search the web once, on public sources, then answer." : "Work from what the team has already gathered and what's well established about persuasion and buyer psychology; don't claim to have searched."} ${note.web ? 'Keep it short: no lists of every page you saw. Finish with only a JSON object inside <note></note> tags: {"finding": string (at most 90 words), "sources": [{"title": string, "url": string}] (the 3 most useful at most)}' : "Answer with the JSON object only (sources: [])."}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Study ${ask}.${saved.length ? `\n\nAlready gathered:\n- ${saved.join("\n- ").slice(0, 3000)}` : ""}` }],
    },
  });
  const parsed = note.web ? parseTagged<{ finding: string; sources: Note["sources"] }>(textOf(res.message), "note") : jsonOf<{ finding: string; sources: Note["sources"] }>(res.message);
  if (!parsed?.finding) {
    await done({ summary: `Couldn't pin down anything new on ${note.angle} this time`, evidence: ev(), inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
    await update(note.id, { stage: "failed" });
    return "nothing";
  }
  const sources = (parsed.sources ?? []).filter((s) => s?.url?.startsWith("http")).slice(0, 3);
  await update(note.id, { stage: "comparing", finding: parsed.finding.slice(0, 900), sources });
  await done({ summary: parsed.finding.slice(0, 380), evidence: ev({ angle: note.angle, topic: note.topic, sources: sources.length }), inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
  return "studied";
}

async function compare(agent: Agent, note: Note, createMessage: CreateMessage) {
  const done = await begin({ agentId: agent.id, runId: null, step: "remembering", tier: "haiku", summary: "Checking the finding against this account's history", evidence: ev() });
  const [{ data: learnings }, { data: ads }, { data: past }] = await Promise.all([
    supabaseAdmin.from("learnings").select("insight").eq("agent_id", agent.id).eq("active", true).order("created_at", { ascending: false }).limit(8),
    supabaseAdmin.from("ads").select("name, status, creatives(hook, traits)").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("research_notes").select("angle, finding, fit").eq("agent_id", agent.id).eq("stage", "done").order("id", { ascending: false }).limit(5),
  ]);
  const res = await callModel({
    task: "librarian",
    tier: "haiku",
    agentId: agent.id,
    runId: null,
    createMessage,
    params: {
      max_tokens: 600,
      output_config: { effort: "low", format: { type: "json_schema", schema: COMPARE_SCHEMA } },
      system: [{ type: "text", text: `${BASE}\n\nYou keep this account's history. Say whether a new market finding fits what this account has learned and the ads it has run: "strong" (builds on what works or fills a clear gap), "maybe", or "weak" (repeats what's running, contradicts results, or doesn't suit these buyers).`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify({ topic: label(note.topic), angle: note.angle, finding: note.finding, learnings: (learnings ?? []).map((l) => l.insight), recent_ads: (ads ?? []).map((a) => ({ name: a.name, status: a.status, hook: (a.creatives as { hook?: string } | null)?.hook })), past_research: past ?? [] }) }],
    },
  });
  const out = jsonOf<{ history: string; fit: Note["fit"] }>(res.message);
  await update(note.id, { stage: "drafting", history: out?.history?.slice(0, 500) ?? null, fit: out?.fit ?? "maybe" });
  await done({ summary: out?.history ? `${out.fit === "strong" ? "Strong fit" : out.fit === "weak" ? "Weak fit" : "Possible fit"}: ${out.history}`.slice(0, 380) : "Compared with the account's history", evidence: ev({ fit: out?.fit }), inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
  return "compared";
}

async function draft(agent: Agent, note: Note, createMessage: CreateMessage) {
  const done = await begin({ agentId: agent.id, runId: null, step: "drafting", tier: "haiku", summary: "Drafting the next creative idea", evidence: ev() });
  const res = await callModel({
    task: "copy_check",
    tier: "haiku",
    agentId: agent.id,
    runId: null,
    createMessage,
    params: {
      max_tokens: 700,
      output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      system: [{ type: "text", text: `${BASE}\n\nYou are the clerk. Turn a research finding into one idea for this agent's next ad (the video or image Migz should make next), then check it against Meta's financial-ad rules. Write for real people, warm and specific; no hype.`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify({ agent: agent.full_name, topic: label(note.topic), what_to_sell: (TOPICS as Record<string, { pitch: string }>)[note.topic]?.pitch, angle: note.angle, finding: note.finding, history: note.history, fit: note.fit }) }],
    },
  });
  const out = jsonOf<Idea & { compliance: string }>(res.message);
  if (!out?.hook_line) {
    await done({ summary: "Couldn't turn this one into an idea", evidence: ev(), inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
    await update(note.id, { stage: "failed" });
    return "nothing";
  }
  const idea: Idea = { format: out.format, hook_line: out.hook_line.slice(0, 120), concept: out.concept.slice(0, 400), why: out.why.slice(0, 300) };
  await update(note.id, { stage: "saving", idea, compliance: out.compliance.slice(0, 300) });
  await done({ summary: `Idea (${idea.format}): "${idea.hook_line}"${/^ok\b/i.test(out.compliance) ? " · passes the ad rules" : " · needs a rules fix"}`.slice(0, 380), evidence: ev({ hook: idea.hook_line }), inputTokens: res.usage.input, outputTokens: res.usage.output, model: res.model });
  return "drafted";
}

async function save(agent: Agent, note: Note) {
  const done = await begin({ agentId: agent.id, runId: null, step: "remembering", tier: "code", summary: "Filing the idea for the next review", evidence: ev() });
  await update(note.id, { stage: "done" });
  const clean = /^ok\b/i.test(note.compliance ?? "");
  await done({
    summary: `Saved to memory: "${note.idea?.hook_line ?? note.angle}"${!clean ? " (held back: breaks an ad rule)" : note.fit === "weak" ? " (weak fit, kept for reference)" : ""}`.slice(0, 380),
    evidence: ev(),
  });
  return "saved";
}

/** The JSON inside <tag></tag>, or failing that the last JSON object in the text. Pure. */
export function parseTagged<T>(text: string, tag: string): T | null {
  const tagged = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
  const candidates = [tagged, text.slice(text.lastIndexOf("{\"finding\""))].filter((x): x is string => !!x && x.includes("{"));
  for (const c of candidates) {
    const json = c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1);
    try {
      return JSON.parse(json) as T;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Every 10 minutes (pg_cron): one research step for each agent on Migz, until the deadline. */
export async function researchShift(deadlineMs: number) {
  // Skips the end-to-end test's throwaway agents (e2e-*), which only exist while a test runs
  const { data: agents } = await supabaseAdmin.from("agents").select("*").eq("active", true).neq("migz_mode", "off").not("onboarding_completed_at", "is", null).not("slug", "like", "e2e-%");
  const results: Record<string, string> = {};
  for (const agent of (agents ?? []) as Agent[]) {
    if (Date.now() > deadlineMs) break;
    results[agent.slug] = await researchTick(agent).catch((e) => `error: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
  }
  return results;
}

const IDEA_MAX_DAYS = 30;

/** The latest finished ideas, for the review (as inspiration when it makes new creatives). */
export async function latestIdeas(agentId: string, limit = 5) {
  const { data, error } = await supabaseAdmin.from("research_notes").select("topic, angle, finding, history, fit, idea, created_at").eq("agent_id", agentId).eq("stage", "done").neq("fit", "weak").order("id", { ascending: false }).limit(limit);
  if (error) return [];
  const daysOld = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  // Market ideas go stale: past IDEA_MAX_DAYS they're left out
  return (data ?? [])
    .filter((n) => n.idea && daysOld(n.created_at) <= IDEA_MAX_DAYS)
    .map((n) => ({ topic: n.topic, angle: n.angle, finding: n.finding, fit: n.fit, idea: n.idea, found: n.created_at.slice(0, 10), days_old: daysOld(n.created_at) }));
}
