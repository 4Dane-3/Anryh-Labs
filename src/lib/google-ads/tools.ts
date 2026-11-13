import type Anthropic from "@anthropic-ai/sdk";
import type { GAction, Term } from "@/lib/google-ads/guardrails";
import { MAX_DESCRIPTIONS, MAX_HEADLINES } from "@/lib/google-ads/playbook";

// Migz's Google Ads tools, as Claude tools. parseAction turns a tool call into a typed action (or says what's
// wrong with its shape); the guardrails then decide whether it may happen.

const why = {
  title: { type: "string", description: "What you did, past tense, under 70 characters, for the roofer's activity feed. E.g. 'Blocked 9 job-seeker searches'." },
  reason: { type: "string", description: "Why, in one or two short sentences with the numbers. E.g. '\"roofing jobs near me\" and 8 more spent $41 with no bookings.'" },
} as const;

const term = {
  type: "object",
  properties: { text: { type: "string" }, match: { type: "string", enum: ["PHRASE", "EXACT"] } },
  required: ["text", "match"],
  additionalProperties: false,
} as const;

function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Beta.BetaTool {
  return { name, description, input_schema: { type: "object", properties: { ...properties, ...why }, required: [...Object.keys(properties), "title", "reason"], additionalProperties: false } };
}

export const GOOGLE_TOOLS: Anthropic.Beta.BetaTool[] = [
  tool("add_negative_keywords", "Block searches that aren't roofing customers in the area (campaign-level negatives). PHRASE blocks any search containing the phrase; EXACT blocks only that exact search.", { terms: { type: "array", items: term } }),
  tool("add_keywords", "Add keywords to an ad group, usually search terms that converted. PHRASE or EXACT only.", { ad_group_id: { type: "string" }, keywords: { type: "array", items: term } }),
  tool("pause_keyword", "Pause a keyword that spent well past the target with no conversion (the system checks the numbers).", { ad_group_id: { type: "string" }, criterion_id: { type: "string" } }),
  tool("resume_keyword", "Turn a paused keyword back on.", { ad_group_id: { type: "string" }, criterion_id: { type: "string" } }),
  tool("write_ad", `Add a responsive search ad to an ad group: 10 to ${MAX_HEADLINES} headlines (30 characters each) and up to ${MAX_DESCRIPTIONS} descriptions (90 each), using only facts from the account's facts.`, {
    ad_group_id: { type: "string" },
    headlines: { type: "array", items: { type: "string" } },
    descriptions: { type: "array", items: { type: "string" } },
    path1: { type: "string", description: "Display path, e.g. 'roof' (15 characters, may be empty)." },
    path2: { type: "string", description: "Second display path, e.g. 'replacement' (may be empty)." },
  }),
  tool("pause_ad", "Pause a responsive search ad that clearly underperforms the best ad in its group (1,500+ impressions), or one Google disapproved.", { ad_group_id: { type: "string" }, ad_id: { type: "string" } }),
  tool("set_daily_budget", "Set the campaign's daily budget in cents. Never above the roofer's monthly cap / 30.4; each change at most 25%, 3+ days apart.", { daily_cents: { type: "integer" } }),
  tool("set_bidding", "MAXIMIZE_CONVERSIONS (no target), or TARGET_CPA with a target cost per conversion in cents once there are 15+ conversions in 30 days.", { strategy: { type: "string", enum: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA"] }, target_cpa_cents: { type: ["integer", "null"] } }),
  tool("hold", "Record that nothing should change today, and why. Once per review at most.", {}),
];

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\D/g, "") : "");
const terms = (v: unknown): Term[] =>
  Array.isArray(v) ? v.map((t) => ({ text: str((t as Term)?.text, 100), match: (t as Term)?.match === "EXACT" ? "EXACT" : (t as Term)?.match === "BROAD" ? "BROAD" : "PHRASE" }) as Term).filter((t) => t.text) : [];
const texts = (v: unknown, max: number) => (Array.isArray(v) ? v.map((s) => str(s, max + 20)).filter(Boolean) : []);

export type Parsed = { action: GAction; title: string; reason: string } | { error: string };

export function parseAction(name: string, raw: unknown): Parsed {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = str(r.title, 90) || name.replace(/_/g, " ");
  const reason = str(r.reason, 600);
  const ok = (action: GAction): Parsed => ({ action, title, reason });
  switch (name) {
    case "add_negative_keywords":
      return ok({ tool: name, terms: terms(r.terms) });
    case "add_keywords":
      return id(r.ad_group_id) ? ok({ tool: name, ad_group_id: id(r.ad_group_id), keywords: terms(r.keywords) }) : { error: "ad_group_id is required." };
    case "pause_keyword":
    case "resume_keyword":
      return id(r.ad_group_id) && id(r.criterion_id) ? ok({ tool: name, ad_group_id: id(r.ad_group_id), criterion_id: id(r.criterion_id) }) : { error: "ad_group_id and criterion_id are required." };
    case "write_ad":
      return id(r.ad_group_id) ? ok({ tool: name, ad_group_id: id(r.ad_group_id), headlines: texts(r.headlines, 30), descriptions: texts(r.descriptions, 90), path1: str(r.path1, 30), path2: str(r.path2, 30) }) : { error: "ad_group_id is required." };
    case "pause_ad":
      return id(r.ad_group_id) && id(r.ad_id) ? ok({ tool: name, ad_group_id: id(r.ad_group_id), ad_id: id(r.ad_id) }) : { error: "ad_group_id and ad_id are required." };
    case "set_daily_budget":
      return typeof r.daily_cents === "number" ? ok({ tool: name, daily_cents: Math.round(r.daily_cents) }) : { error: "daily_cents must be a number of cents." };
    case "set_bidding":
      return r.strategy === "TARGET_CPA" || r.strategy === "MAXIMIZE_CONVERSIONS"
        ? ok({ tool: name, strategy: r.strategy, target_cpa_cents: typeof r.target_cpa_cents === "number" ? Math.round(r.target_cpa_cents) : null })
        : { error: "strategy must be MAXIMIZE_CONVERSIONS or TARGET_CPA." };
    case "hold":
      return ok({ tool: "hold" });
    default:
      return { error: `Unknown tool ${name}.` };
  }
}
