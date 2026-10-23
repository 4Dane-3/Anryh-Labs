// Client-safe shapes for the admin dashboard (the queries live in overview.ts, which is server-only).
import type { Severity } from "@/lib/admin/issues";
import type { BrainEvent } from "@/lib/migz/brain-types";

export type AdminAlert = {
  id: number;
  agentId: string | null;
  agentName: string;
  agentSlug: string | null;
  source: "scan" | "event";
  severity: Severity;
  title: string;
  detail: string;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  resolvedBy: string | null; // "auto" when the problem went away, else the staff member who marked it handled
  slackSentAt: string | null;
};

export type AdminAgentRow = {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  mode: string;
  setupDone: boolean;
  connected: boolean;
  slack: boolean;
  lastRun: { status: string; at: string } | null;
  batch: { day: number; days: number; budgetCents: number; spentCents: number } | null;
  balanceCents: number;
  today: { spendCents: number; budgetCents: number; impressions: number; linkClicks: number; bookedCalls: number } | null;
  metaError: string | null;
  liveAds: number;
  alerts: Record<Severity, number>;
  working: string | null; // what Migz is doing for this agent right now
};

export type AdminOverview = {
  at: string;
  alertsReady: boolean; // false until the admin_alerts migration runs
  agents: AdminAgentRow[];
  open: AdminAlert[];
  recent: AdminAlert[];
  activity: { id: number; agentName: string; agentSlug: string | null; step: string; tier: BrainEvent["tier"]; summary: string; at: string; open: boolean }[];
  totals: { spendTodayCents: number; budgetTodayCents: number; runningBatches: number; working: number };
};
