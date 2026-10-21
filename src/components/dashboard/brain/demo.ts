// A sample review for presentations: clearly labelled in the UI, never the default, never saved.
import type { Tier } from "@/components/dashboard/brain/model";

type DemoEvent = { at: number; dur?: number; step: string; tier: Tier; model?: string; summary: string; evidence?: Record<string, unknown>; tokens?: number };

export const DEMO_SCRIPT: DemoEvent[] = [
  { at: 0, dur: 2, step: "syncing", tier: "code", summary: "Synced 14 days: $214.60 spent, 18,420 impressions, 9 booked calls", evidence: { spend: "$214.60", booked_calls: 9 } },
  { at: 2.5, dur: 2.5, step: "auditing", tier: "haiku", model: "claude-haiku-5-5", summary: "9 checks: 1 to watch (ad set learning for 8 days)", evidence: { critical: 0, warn: 1 }, tokens: 1840 },
  { at: 5.5, dur: 1, step: "triaging", tier: "code", summary: "Full review: 3 new booked calls; 2,300 new impressions", evidence: { reasons: 2 } },
  { at: 7, dur: 3, step: "watching", tier: "sonnet", model: "claude-sonnet-5-5", summary: "Video (7 frames): mortgage protection, question hook, low compliance risk", tokens: 6200 },
  { at: 10.5, dur: 1.5, step: "remembering", tier: "haiku", model: "claude-haiku-5-5", summary: 'Found 3 related records for "work policy hook"', tokens: 900 },
  { at: 12.5, dur: 2.5, step: "advising", tier: "opus", model: "claude-opus-5-5", summary: "Consulted the advisor (1 of 3)" },
  { at: 15.5, dur: 1, step: "hypothesizing", tier: "code", summary: "Planned experiment: a work-coverage hook beats family protection on hook rate", evidence: { lever: "hook", min_impressions: 1500 } },
  { at: 17, dur: 1, step: "checking", tier: "haiku", model: "claude-haiku-5-5", summary: "Copy check passed: 2 lines, no claims" },
  { at: 18.5, dur: 2.5, step: "drafting", tier: "higgsfield", summary: "Launched a new hook on the winning video", evidence: { hook: "Your work policy ends when your job does." } },
  { at: 21.5, dur: 1.5, step: "acting", tier: "code", summary: "Paused image ad B", evidence: { reason: "Link CTR 0.41% after 2,100 impressions, a third of the ad set average" } },
  { at: 23.5, dur: 1.5, step: "remembering", tier: "code", summary: "Learned: question hooks lift hook rate on this account (31% vs 22%)" },
  { at: 25.5, dur: 1.5, step: "checking", tier: "haiku", model: "claude-haiku-5-5", summary: "Wrote the activity feed summary", tokens: 600 },
  { at: 27.5, dur: 0.5, step: "finished", tier: "code", summary: "Paused a weak image ad and started a hook test on the winning video." },
];
