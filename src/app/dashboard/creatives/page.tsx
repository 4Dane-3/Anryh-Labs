import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { integrations } from "@/lib/integrations";
import { NotConnected, PageHeader } from "@/components/dashboard/ui";
import { CreativesManager, type Creative } from "@/components/dashboard/CreativesManager";

export default async function CreativesPage() {
  const agent = await requireAgent();

  const { data } = await supabaseAdmin
    .from("creatives")
    .select("id, kind, storage_path, file_name, mime_type, size_bytes, status, review_note, created_at")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  // Private bucket: hand the browser short-lived signed URLs for previews
  const { data: signed } = rows.length
    ? await supabaseAdmin.storage.from("creatives").createSignedUrls(rows.map((r) => r.storage_path), 3600)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const creatives: Creative[] = rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null }));

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
      <CreativesManager creatives={creatives} />
    </>
  );
}
