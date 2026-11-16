// What competitor research hands to the live campaign, and when the first Google build waits for it. Pure, so the
// tests cover it.
//   The ad: the 15 headlines and 4 descriptions that passed the 9/10 gate go into every ad group, next to the
//     group's own ad. Google rotates them and the weekly review pauses the loser.
//   The landing page: its copy is used only when the judge was 9/10 sure it beats every competitor page it was
//     tested against. Lines written for the old booking flow ("book online", "pick a time") are dropped: the page
//     asks for a quote request now.
//   The first build waits for research: it starts on its own when a roofer turns Google on, and the build waits up
//     to RESEARCH_WAIT_HOURS for it, then goes ahead with the playbook's own ads (a slow or failed run never holds a
//     client's campaign back).

import type { Drafts } from "@/lib/competitors/types";
import { PUBLISH_CONFIDENCE } from "@/lib/competitors/gates";

export const RESEARCH_WAIT_HOURS = 6;

const BOOKING = /\b(book(ing|ed|s)?|schedul(e|ing)|pick a (time|slot)|calendar|appointment)\b/i;

/** True when a line still talks about booking a time, which the quote request page doesn't offer. */
export const talksBooking = (s: string) => BOOKING.test(s);

/** Text with every sentence that talks about booking a time taken out. */
export function withoutBooking(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  return sentences
    .filter((s) => !talksBooking(s))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export type ResearchLanding = { subhead: string | null; offer: string | null; proof: string[]; sections: { title: string; body: string }[]; cta: string | null; confidence: number };

/** The research landing copy, ready for the page, or null when it didn't win 9/10 against every competitor page. */
export function usableLanding(drafts: Pick<Drafts, "landing"> | null | undefined): ResearchLanding | null {
  const l = drafts?.landing;
  if (!l || !l.versus?.length) return null;
  const confidence = Math.min(...l.versus.map((v) => v.confidence));
  if (!(confidence >= PUBLISH_CONFIDENCE)) return null;
  const sections = (l.sections ?? [])
    .map((s) => ({ title: s.title?.trim() ?? "", body: withoutBooking(s.body ?? "") }))
    .filter((s) => s.title && s.body && !talksBooking(s.title));
  const keep = (s: string | null | undefined) => (s && !talksBooking(s) ? s.trim() : null);
  return {
    subhead: keep(l.subhead),
    offer: keep(l.offer),
    proof: (l.proof ?? []).map((p) => p.trim()).filter((p) => p && !talksBooking(p)).slice(0, 6),
    sections: sections.slice(0, 6),
    cta: keep(l.cta),
    confidence,
  };
}

/** The ad that beat the competitors, when the 9/10 gate passed. */
export function winningAd(drafts: Pick<Drafts, "kept" | "verdict"> | null | undefined) {
  if (!drafts?.verdict?.publishable) return null;
  const { headlines, descriptions, path1, path2 } = drafts.kept;
  return { headlines, descriptions, path1, path2 };
}

export type ResearchState = { status: "none" } | { status: "running"; startedAt: string } | { status: "done" } | { status: "failed" };

/**
 * Whether the first Google build goes ahead now. "start": no research yet, start it and wait. "wait": it's running
 * and young enough to wait for. "build": go (with the winning ad if there is one).
 */
export function firstBuildStep(research: ResearchState, canResearch: boolean, now = Date.now()): "start" | "wait" | "build" {
  if (research.status === "none") return canResearch ? "start" : "build";
  if (research.status === "running") return now - Date.parse(research.startedAt) < RESEARCH_WAIT_HOURS * 3_600_000 ? "wait" : "build";
  return "build";
}
