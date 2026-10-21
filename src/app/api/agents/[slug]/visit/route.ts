import { supabaseAdmin } from "@/lib/supabase-admin";

// One row per page view of an agent's booking page, with the ad that sent it (utm_content = Meta ad
// id), so Migz can tell a creative problem from a landing-page problem. No IP, cookie or person data.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await req.json().catch(() => ({}))) as { utm_source?: unknown; utm_content?: unknown };
  const clean = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 64) : null);

  const { data: agent } = await supabaseAdmin.from("agents").select("id").eq("slug", slug).eq("active", true).maybeSingle();
  if (!agent) return new Response(null, { status: 204 });

  await supabaseAdmin.from("page_visits").insert({
    agent_id: agent.id,
    utm_source: clean(body.utm_source),
    utm_content: clean(body.utm_content),
  });
  return new Response(null, { status: 204 });
}
