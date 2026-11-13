import { notFound } from "next/navigation";
import { requireSetUpAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Panel, PanelHeader, PageHeader } from "@/components/dashboard/ui";
import { GoogleAdsSetup } from "@/components/dashboard/GoogleAdsSetup";
import { GoogleProposals } from "@/components/dashboard/GoogleProposals";
import { googleSetup } from "@/lib/dashboard/google-setup";
import { getGoogleAccount } from "@/lib/google-ads/account";
import { cpaCents, type GoogleSnapshot } from "@/lib/google-ads/types";
import { isRoofer } from "@/lib/verticals";

export const dynamic = "force-dynamic";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default async function GooglePage() {
  const agent = await requireSetUpAgent();
  if (!isRoofer(agent)) notFound();
  const [setup, account, { data: actions }] = await Promise.all([
    googleSetup(agent),
    getGoogleAccount(agent.id),
    supabaseAdmin.from("google_ads_actions").select("id, tool, title, reason, status, created_at").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(40),
  ]);
  const snap = (account?.snapshot ?? null) as GoogleSnapshot | null;
  const rows = actions ?? [];
  const proposed = rows.filter((r) => r.status === "proposed");
  const done = rows.filter((r) => r.status !== "proposed" && r.tool !== "hold").slice(0, 25);
  const t = snap?.totals30;
  const cpa = t ? cpaCents(t) : null;

  return (
    <>
      <PageHeader title="Google Ads" description="Search ads for homeowners looking for a roofer right now, run by Migz in your own Google Ads account. You pay Google directly; Migz never budgets past your monthly cap." />
      <div className="space-y-6">
        {snap && t && (
          <Panel>
            <PanelHeader title="Last 30 days" description={`Synced ${new Date(snap.takenAt).toLocaleString("en-US", { timeZone: agent.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. This month: ${money(snap.monthSpendCents)} of ${money(account!.monthly_cap_cents)}.`} />
            <div className="grid grid-cols-2 gap-4 px-5 py-5 sm:grid-cols-4">
              {[
                ["Spent", money(t.costCents)],
                ["Clicks", t.clicks.toLocaleString("en-US")],
                ["Conversions", String(t.conversions)],
                ["Cost per conversion", cpa ? money(cpa) : "None yet"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[12px] text-fg-muted">{label}</p>
                  <p className="mt-1 text-xl font-semibold tracking-tight text-fg">{value}</p>
                </div>
              ))}
            </div>
            <p className="border-t border-line px-5 py-3 text-[12px] text-fg-muted">Conversions are booked inspections and 60-second calls from your ads. Closed jobs you mark done are sent to Google too, so it learns who actually hires you.</p>
          </Panel>
        )}
        {proposed.length > 0 && (
          <Panel>
            <PanelHeader title="Waiting for your OK" description="Migz blocks wasted searches and pauses losers on its own. Changes that could raise spend or change your ads wait for you." />
            <GoogleProposals items={proposed.map((p) => ({ id: p.id, title: p.title, reason: p.reason ?? "" }))} />
          </Panel>
        )}
        <Panel>
          <PanelHeader title={setup.account ? "Your Google Ads account" : "Connect Google Ads"} />
          <div className="px-5 py-5">
            <GoogleAdsSetup initial={setup} />
          </div>
        </Panel>
        {done.length > 0 && (
          <Panel>
            <PanelHeader title="What Migz changed" />
            <ul className="divide-y divide-line">
              {done.map((r) => (
                <li key={r.id} className="px-5 py-3">
                  <p className="text-sm text-fg">
                    {r.title}
                    {r.status !== "applied" && <span className="ml-2 text-[12px] text-fg-muted">({r.status})</span>}
                  </p>
                  {r.reason && <p className="mt-0.5 text-[12px] text-fg-muted">{r.reason}</p>}
                  <p className="mt-0.5 text-[11px] text-fg-faint">{new Date(r.created_at).toLocaleDateString("en-US", { timeZone: agent.timezone, month: "short", day: "numeric" })}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
