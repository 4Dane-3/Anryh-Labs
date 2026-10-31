import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PageHeader } from "@/components/dashboard/ui";
import { LandingEditor } from "@/components/dashboard/LandingEditor";
import { partnerPage } from "@/lib/booking/sites";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const agent = await requireAgent();
  const { tab } = await searchParams;
  // Agents whose page lives on their agency's site (Foreign Financial) see and preview that one
  const pageUrl = partnerPage(agent.slug) ?? `/${agent.slug}`;

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
            <a href={pageUrl} target="_blank" rel="noreferrer" className="text-fg underline-offset-4 hover:underline">
              {pageUrl.replace(/^https:\/\//, "")}
            </a>
            .
          </>
        }
      />
      <LandingEditor
        tab={tab === "testimonials" ? "testimonials" : "profile"}
        pageUrl={pageUrl}
        profile={{
          full_name: agent.full_name,
          title: agent.title ?? "",
          headline: agent.headline ?? "",
          bio: agent.bio ?? "",
          license_number: agent.license_number ?? "",
          licensed_states: agent.licensed_states,
          photo_url: agent.photo_url,
          partner_carriers: agent.partner_carriers ?? [],
        }}
        testimonials={testimonials ?? []}
        pageFontKey={agent.page_font ?? "arial"}
      />
    </>
  );
}
