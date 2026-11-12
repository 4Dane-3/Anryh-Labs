import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { isRoofer } from "@/lib/verticals";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/dashboard/ui";
import { SpecialCheck } from "@/components/dashboard/SpecialCheck";
import { adsPromoting } from "@/lib/roofing/special-check";

export const dynamic = "force-dynamic";

// Where Migz's weekly "is your special still running?" email and Slack message land
export default async function SpecialPage({ searchParams }: { searchParams: Promise<{ answer?: string }> }) {
  const [agent, query] = await Promise.all([requireAgent(), searchParams]);
  if (!isRoofer(agent)) redirect("/dashboard");
  const full = await supabaseAdmin.from("agent_brand").select("deals, special_confirmed_at").eq("agent_id", agent.id).maybeSingle();
  // Before migration 20261211000000 there's no confirmed date: still show the special
  const row = full.error ? (await supabaseAdmin.from("agent_brand").select("deals").eq("agent_id", agent.id).maybeSingle()).data : full.data;
  const special = (row?.deals as string[] | undefined)?.[0] ?? null;
  const live = special ? await adsPromoting(agent.id, special) : [];
  return (
    <>
      <PageHeader title="Your special" description="The offer your ads feature. Migz checks with you every week that it's still running." />
      <SpecialCheck
        special={special}
        confirmedAt={((row as { special_confirmed_at?: string | null } | null)?.special_confirmed_at as string | null) ?? null}
        liveAds={live.length}
        answer={query.answer === "yes" || query.answer === "ended" ? query.answer : null}
      />
    </>
  );
}
