import { PageHead } from "@/components/admin/AdminShell";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { apifyReady } from "@/lib/apify";
import { googleAdsReady } from "@/lib/google-ads/api";
import { getGoogleAccount, manageable } from "@/lib/google-ads/account";
import { getAdContext, latestRun } from "@/lib/competitors/store";
import { CompetitorsView } from "@/components/admin/competitors/CompetitorsView";
import { areaLabel } from "@/lib/verticals";
import type { Agent } from "@/lib/booking/data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Competitor ads · Admin" };

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const sp = await searchParams;
  const { data } = await supabaseAdmin.from("agents").select("*").eq("vertical", "roofing").order("full_name");
  const roofers = (data ?? []) as Agent[];
  // With no roofer picked, open on whoever was researched last (not whoever sorts first)
  const { data: last } = sp.agent ? { data: null } : await supabaseAdmin.from("competitor_runs").select("agent_id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const agent = roofers.find((a) => a.id === (sp.agent ?? last?.agent_id)) ?? roofers[0] ?? null;
  const [run, context, google] = agent ? await Promise.all([latestRun(agent.id), getAdContext(agent.id), getGoogleAccount(agent.id)]) : [null, null, null];
  const { error: tableMissing } = await supabaseAdmin.from("competitor_runs").select("id").limit(1);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <PageHead
        eyebrow="Migz"
        title="Competitor ads"
        description={<>Who advertises against a roofer, every ad they run on Google and Facebook, which ones are winning and why, and ads that beat them. Migz reads the results in its reviews.</>}
      />
      <CompetitorsView
        roofers={roofers.map((r) => ({ id: r.id, name: r.full_name, area: areaLabel(r) }))}
        agentId={agent?.id ?? null}
        initialRun={run}
        context={context}
        ready={{ apify: apifyReady(), migration: !tableMissing, google: googleAdsReady(), googleLinked: manageable(google) }}
      />
    </div>
  );
}
