// A research run as stored, and its stages. Pure: the admin page reads it too.
import type { Advertiser, CompAd, Drafts, LandingPage, Market, Published } from "@/lib/competitors/types";

export type Job = { key: string; actor: string; runId: string | null; status: string; usd: number; meta: Record<string, unknown>; datasetId?: string | null; error?: string | null };

export type Stage = "maps" | "homepages" | "ads" | "read" | "rank" | "context" | "write" | "buyer" | "judge" | "done";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "maps", label: "Top roofers on Google Maps" },
  { key: "homepages", label: "Their websites and Facebook Pages" },
  { key: "ads", label: "Their Google and Facebook ads" },
  { key: "read", label: "Reading the ads and the pages behind them" },
  { key: "rank", label: "Ranking the winners and their offers" },
  { key: "context", label: "Your business: site, reviews, testimonials, videos" },
  { key: "write", label: "Writing 150 headlines" },
  { key: "buyer", label: "The harsh buyer test" },
  { key: "judge", label: "Ours vs theirs, and the 9/10 gate" },
  { key: "done", label: "Done" },
];

export type Run = {
  id: string;
  agent_id: string;
  status: "running" | "done" | "failed" | "canceled";
  stage: Stage;
  markets: Market[];
  jobs: Job[];
  advertisers: Advertiser[];
  ads: CompAd[];
  pages: LandingPage[];
  drafts: Drafts | null;
  progress: Record<string, unknown>;
  published: Published | null;
  budget_usd: number;
  cost_usd: number;
  log: { at: string; text: string }[];
  error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

