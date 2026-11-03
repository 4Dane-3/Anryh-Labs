import { POSTS, type Block } from "@/lib/blog/posts";
import { ALSO_INCLUDED, COVERED, MIN_FUNDS, NOT_COVERED, PRICING_SUMMARY, SETUP_FEE, TIERS, pct, sliceLabel, usd } from "@/lib/pricing";
import { HOME_FAQS, PRICING_FAQS } from "@/lib/seo/faqs";
import { INSURANCE_TYPES } from "@/lib/seo/insurance-types";
import { absoluteUrl } from "@/lib/site";

// /llms.txt (an index) and /llms-full.txt (the same, with the answers inline): plain markdown for AI assistants
// and the crawlers behind them. Built from the same data as the pages, so it never drifts.

const ABOUT =
  "Anryh Labs makes Migz AI, an AI media buyer for independent life insurance agents in the US. It runs the agent's whole Meta (Facebook and Instagram) ad campaign: it builds the ads, makes image and video creatives, sends people to an instant lead form or a booking page, messages the agent on Slack when a lead arrives, and reads results through the day to adjust budget and ads. Invite only.";

const bodyText = (b: Block) => ("h" in b ? `\n### ${b.h}\n` : "p" in b ? b.p : b.ul.map((x) => `- ${x}`).join("\n"));

export function llmsIndex() {
  return [
    "# Anryh Labs",
    "",
    `> ${ABOUT}`,
    "",
    "## Key pages",
    `- [Home](${absoluteUrl()}): what Migz AI does`,
    `- [Pricing](${absoluteUrl("/pricing")}): ${usd(SETUP_FEE)} setup, then ${TIERS.map((t, i) => `${pct(t.rate)} of ${sliceLabel(i)}`).join(", ")}`,
    `- [Life insurance ads by coverage type](${absoluteUrl("/life-insurance-ads")})`,
    `- [Blog](${absoluteUrl("/blog")})`,
    "",
    "## Coverage types",
    ...INSURANCE_TYPES.map((t) => `- [${t.name}](${absoluteUrl(`/life-insurance-ads/${t.slug}`)}): ${t.answer}`),
    "",
    "## Blog",
    ...POSTS.map((p) => `- [${p.title}](${absoluteUrl(`/blog/${p.slug}`)}): ${p.description}`),
    "",
    "## Optional",
    `- [Full text of these pages](${absoluteUrl("/llms-full.txt")})`,
    `- [Privacy](${absoluteUrl("/privacy")})`,
    `- [Terms](${absoluteUrl("/terms")})`,
    "",
  ].join("\n");
}

export function llmsFull() {
  return [
    "# Anryh Labs",
    "",
    `> ${ABOUT}`,
    "",
    "## Pricing",
    PRICING_SUMMARY,
    "",
    `- One-time setup fee: ${usd(SETUP_FEE)}. No monthly fee, no contract. Minimum ad funds: ${usd(MIN_FUNDS)}.`,
    ...TIERS.map((t, i) => `- ${pct(t.rate)} of ${sliceLabel(i)} you add`),
    "",
    "The percentage covers:",
    ...COVERED.map((c) => `- ${c.title}: ${c.text}`),
    "Also included:",
    ...ALSO_INCLUDED.map((x) => `- ${x}`),
    "Not included:",
    ...NOT_COVERED.map((x) => `- ${x}`),
    "",
    "## Frequently asked questions",
    ...[...HOME_FAQS, ...PRICING_FAQS.slice(1)].flatMap((f) => [`### ${f.q}`, f.a, ""]),
    "## Coverage types Migz AI can advertise",
    ...INSURANCE_TYPES.flatMap((t) => [`### ${t.name} (${absoluteUrl(`/life-insurance-ads/${t.slug}`)})`, t.answer, `Who buys it: ${t.buyers}`, ""]),
    "## Blog",
    ...POSTS.flatMap((p) => [`## ${p.title} (${absoluteUrl(`/blog/${p.slug}`)})`, p.answer, ...p.body.map(bodyText), ""]),
  ].join("\n");
}
