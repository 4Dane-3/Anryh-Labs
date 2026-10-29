import { DateTime } from "luxon";
import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { integrations } from "@/lib/integrations";
import { briefLabel, isVideoBrief, type AnyBrief } from "@/lib/migz/brief";
import { NotConnected, PageHeader } from "@/components/dashboard/ui";
import { CreativesManager, type Creative, type GeneratingJob } from "@/components/dashboard/CreativesManager";

export default async function CreativesPage() {
  const agent = await requireAgent();

  const { data } = await supabaseAdmin
    .from("creatives")
    .select("id, kind, storage_path, file_name, mime_type, size_bytes, status, review_note, created_at, source, hook")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  // Private bucket: hand the browser short-lived signed URLs for previews
  const { data: signed } = rows.length
    ? await supabaseAdmin.storage.from("creatives").createSignedUrls(rows.map((r) => r.storage_path), 3600)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  // 14-day results per creative: Meta spend from insights, booked calls from our bookings (utm_content = ad id)
  const since = DateTime.now().setZone(agent.timezone).minus({ days: 13 }).startOf("day");
  const [{ data: ads }, { data: insights }, { data: bookings }, { data: jobs }] = await Promise.all([
    supabaseAdmin
      .from("ads")
      .select("meta_ad_id, creative_id, status, ad_sets(status, ad_campaigns(status, retired_at))")
      .eq("agent_id", agent.id)
      .not("creative_id", "is", null),
    supabaseAdmin
      .from("ad_insights_daily")
      .select("meta_ad_id, spend_cents")
      .eq("agent_id", agent.id)
      .gte("date", since.toISODate()!),
    supabaseAdmin
      .from("bookings")
      .select("attribution")
      .eq("agent_id", agent.id)
      .gte("created_at", since.toUTC().toISO()!),
    supabaseAdmin
      .from("creative_jobs")
      .select("id, stage, brief, created_at")
      .eq("agent_id", agent.id)
      .in("stage", ["generating", "meta_processing"])
      .order("created_at", { ascending: false }),
  ]);

  const creativeByAd = new Map((ads ?? []).map((a) => [a.meta_ad_id, a.creative_id as string]));
  // Live means Meta can deliver one of its ads now: the ad, its ad set and its campaign all on. A creative
  // whose ads were all paused or retired keeps "live" in the table, so it shows as paused here.
  type AdSetJoin = { status: string; ad_campaigns: { status: string; retired_at: string | null } | null } | null;
  const running = new Set(
    (ads ?? [])
      .filter((a) => {
        const set = a.ad_sets as unknown as AdSetJoin;
        return a.status === "ACTIVE" && set?.status === "ACTIVE" && set.ad_campaigns?.status === "ACTIVE" && !set.ad_campaigns.retired_at;
      })
      .map((a) => a.creative_id as string),
  );
  const stats = new Map<string, { spend_cents: number; booked: number }>();
  const bump = (creativeId: string | undefined, spend: number, booked: number) => {
    if (!creativeId) return;
    const s = stats.get(creativeId) ?? { spend_cents: 0, booked: 0 };
    s.spend_cents += spend;
    s.booked += booked;
    stats.set(creativeId, s);
  };
  for (const row of insights ?? []) bump(creativeByAd.get(row.meta_ad_id), row.spend_cents, 0);
  for (const b of bookings ?? []) bump(creativeByAd.get((b.attribution as Record<string, string>)?.utm_content), 0, 1);

  const creatives: Creative[] = rows.map((r) => ({
    ...r,
    status: r.status === "live" && !running.has(r.id) ? "paused" : r.status,
    url: urlByPath.get(r.storage_path) ?? null,
    stats: stats.get(r.id) ?? null,
  }));

  const generating: GeneratingJob[] = (jobs ?? []).map((j) => ({
    id: j.id,
    stage: j.stage,
    format: isVideoBrief(j.brief as AnyBrief) ? "video" : "image", // carousels are made of images
    hook: briefLabel(j.brief as AnyBrief),
  }));

  return (
    <>
      <PageHeader
        title="Creatives"
        description="Photos and videos Migz AI uses in your ads. Clips of you talking to the camera usually perform best."
      />
      {!integrations.meta && (
        <div className="mb-6">
          <NotConnected service="Meta">Upload now. Migz adds your files to your campaigns once your ad account is linked.</NotConnected>
        </div>
      )}
      <CreativesManager creatives={creatives} generating={generating} />
    </>
  );
}
