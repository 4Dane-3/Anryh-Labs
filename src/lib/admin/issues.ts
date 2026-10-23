// What counts as a problem on an agent's account, as a pure function so every rule is unit-tested. The
// scanner (health.ts) gathers the facts from Meta and our tables; this decides what to raise.

export type Severity = "critical" | "warn" | "info";
export type Issue = { key: string; severity: Severity; title: string; detail: string };

export type MetaThing = { id: string; name: string; effective_status: string };
export type HealthInput = {
  agent: { id: string; slug: string; name: string; mode: string; setupDone: boolean; adAccount: string | null; slack: boolean; lastRunAt: string | null };
  now: number;
  testMode: boolean;
  lastRun: { status: string; started_at: string; error: string | null } | null;
  batch: { day: number; days: number; budgetCents: number; spentCents: number } | null; // the running batch
  meta: {
    error: string | null;
    accountStatus: number | null;
    campaigns: (MetaThing & { retired: boolean })[]; // Migz's campaigns only
    adsets: (MetaThing & { retired: boolean })[];
    ads: (MetaThing & { reviewFeedback: string | null })[];
  } | null;
  spend: { todayCents: number; yesterdayCents: number };
  jobs: { id: string; stage: string; updated_at: string; brief: string }[]; // open creative jobs
  modelBudgetRatio: number;
  staleProposals: number; // waiting for the agent's OK for over a day
};

/** Meta's ad account states (https://developers.facebook.com/docs/marketing-api/reference/ad-account). */
const ACCOUNT_STATUS: Record<number, string> = {
  2: "disabled",
  3: "unsettled (a payment failed)",
  7: "under Meta's risk review",
  8: "waiting on a settlement",
  9: "in a grace period",
  100: "closing",
  101: "closed",
};

const REVIEW_OVERDUE_HOURS = 9; // reviews run every 6 hours, checked hourly
const STUCK_MINUTES: Record<string, number> = { generating: 90, meta_processing: 60, stored: 30 };
const PAUSED = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function findIssues(h: HealthInput): Issue[] {
  const out: Issue[] = [];
  const a = h.agent;
  const k = (what: string) => `${what}:${a.id}`;
  const add = (key: string, severity: Severity, title: string, detail: string) => out.push({ key, severity, title, detail });

  if (a.setupDone && !a.adAccount)
    add(k("meta_missing"), a.mode === "off" ? "info" : "critical", "Meta isn't connected", "Setup is done but there's no ad account, so Migz can't run ads or reviews.");

  if (h.meta?.error) add(k("meta_error"), "critical", "Couldn't read the ad account from Meta", h.meta.error.slice(0, 300));
  const status = h.meta?.accountStatus;
  if (status && status !== 1)
    add(k("account_status"), "critical", `Ad account is ${ACCOUNT_STATUS[status] ?? `in state ${status}`}`, "Meta won't deliver ads until this is fixed in Ads Manager (billing or account quality).");

  // Reviews
  const live = a.mode !== "off" && a.setupDone && !!a.adAccount;
  // A failed review is reported as it happens (an event alert) and closes when a later review works
  if (live && a.lastRunAt && h.now - new Date(a.lastRunAt).getTime() > REVIEW_OVERDUE_HOURS * 3_600_000)
    add(k("review_overdue"), "warn", "Reviews have stopped", `No review since ${new Date(a.lastRunAt).toISOString().slice(0, 16).replace("T", " ")} UTC; they should run every 6 hours.`);
  if (a.mode === "off" && a.setupDone) add(k("migz_off"), "info", "Migz is switched off", "The agent turned Migz off: no reviews or changes.");

  // The running batch: what should be delivering
  if (h.batch && h.meta && !h.testMode) {
    const campaigns = h.meta.campaigns.filter((c) => !c.retired);
    const adsets = h.meta.adsets.filter((s) => !s.retired);
    for (const c of campaigns)
      if (PAUSED.has(c.effective_status)) add(`campaign_paused:${c.id}`, "warn", "A campaign is paused in Meta", `${c.name} is paused during a running batch, so it isn't spending.`);
    for (const s of adsets)
      if (s.effective_status === "PAUSED") add(`adset_paused:${s.id}`, "warn", "An ad set is paused in Meta", `${s.name} is paused during a running batch.`);
    const running = h.meta.ads.filter((x) => x.effective_status === "ACTIVE").length;
    const inReview = h.meta.ads.filter((x) => x.effective_status === "PENDING_REVIEW" || x.effective_status === "IN_PROCESS").length;
    if (campaigns.length && !running && !inReview) add(k("no_ads"), "critical", "No ads are running", `Batch day ${h.batch.day} of ${h.batch.days}, but no ad is active or in review.`);
    if (h.batch.day >= 2 && running && !h.spend.todayCents && !h.spend.yesterdayCents)
      add(k("not_spending"), "warn", "Ads aren't spending", `${running} ad${running === 1 ? " is" : "s are"} active but nothing has spent since yesterday. Check billing and delivery in Ads Manager.`);
    if (h.batch.spentCents > h.batch.budgetCents * 1.02)
      add(k("overspend"), "critical", "The batch is over budget", `${usd(h.batch.spentCents)} spent of a ${usd(h.batch.budgetCents)} batch.`);
  }

  // Ads Meta won't run
  for (const ad of h.meta?.ads ?? []) {
    if (ad.effective_status === "DISAPPROVED")
      add(`ad_rejected:${ad.id}`, "critical", "Meta rejected an ad", `${ad.name}${ad.reviewFeedback ? `: ${ad.reviewFeedback}` : ""}`.slice(0, 300));
    else if (ad.effective_status === "WITH_ISSUES") add(`ad_issues:${ad.id}`, "warn", "An ad has delivery issues", ad.name);
  }
  const paused = (h.meta?.ads ?? []).filter((x) => x.effective_status === "PAUSED");
  if (paused.length)
    add(k("ads_paused"), "info", `${paused.length} ad${paused.length === 1 ? " is" : "s are"} paused`, paused.map((x) => x.name).join(" · ").slice(0, 300));

  // Creatives that stopped moving
  for (const j of h.jobs) {
    const limit = STUCK_MINUTES[j.stage];
    const mins = (h.now - new Date(j.updated_at).getTime()) / 60_000;
    if (limit && mins > limit) add(`job_stuck:${j.id}`, "warn", "A creative is stuck", `${j.brief} has been "${j.stage.replace("_", " ")}" for ${Math.round(mins)} minutes.`);
  }

  if (h.modelBudgetRatio >= 1) add(k("model_budget"), "warn", "AI budget used up for the month", "Migz has moved to cheaper models and stopped optional work until next month (or a higher budget).");
  else if (h.modelBudgetRatio >= 0.8) add(k("model_budget"), "info", `AI budget ${Math.round(h.modelBudgetRatio * 100)}% used`, "Market research and live check-in notes are paused to save the rest.");
  if (h.staleProposals) add(k("stale_proposals"), "info", `${h.staleProposals} suggestion${h.staleProposals === 1 ? "" : "s"} waiting over a day`, "In Ask me first mode, these wait for the agent's OK and expire after 2 days.");
  if (a.setupDone && !a.slack) add(k("no_slack"), "info", "Slack isn't connected", "The agent doesn't get Migz's Slack updates (ads sent, approved, review summaries).");

  return out;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
