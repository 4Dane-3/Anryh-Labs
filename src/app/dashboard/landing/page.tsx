import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/dashboard/ui";
import { LandingEditor } from "@/components/dashboard/LandingEditor";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const agent = await requireAgent();
  const { tab } = await searchParams;

  const { data: testimonials } = await supabaseAdmin
    .from("testimonials")
    .select("id, author_name, author_detail, quote, rating, published")
    .eq("agent_id", agent.id)
    .order("sort");

  return (
    <>
      <PageHeader
        title="My page"
        description={
          <>
            What people see when they tap your ad, at{" "}
            <a href={`/${agent.slug}`} target="_blank" rel="noreferrer" className="text-fg underline-offset-4 hover:underline">
              /{agent.slug}
            </a>
            .
          </>
        }
      />
      <LandingEditor
        tab={tab === "testimonials" ? "testimonials" : "profile"}
        slug={agent.slug}
        profile={{
          full_name: agent.full_name,
          headline: agent.headline ?? "",
          bio: agent.bio ?? "",
          license_number: agent.license_number ?? "",
          licensed_states: agent.licensed_states,
          photo_url: agent.photo_url,
        }}
        testimonials={testimonials ?? []}
      />
    </>
  );
}
