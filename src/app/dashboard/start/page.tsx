import { requireAgent } from "@/lib/auth";
import { CONTACT_EMAIL } from "@/lib/contact";
import { integrations, migzReadyFor } from "@/lib/integrations";
import { getSetupState } from "@/lib/dashboard/setup";
import { StartWizard } from "@/components/dashboard/start/StartWizard";
import { PageHeader } from "@/components/dashboard/ui";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  const agent = await requireAgent();
  const state = await getSetupState(agent);

  return (
    <>
      <PageHeader
        title={state.completed ? "Setup" : "Start here"}
        description="Everything you need to run your first campaign, in order. Migz handles the rest."
      />
      <StartWizard
        steps={state.steps.map(({ key, done, missing }) => ({ key, done, missing }))}
        profile={{
          full_name: agent.full_name,
          title: agent.title ?? "",
          headline: agent.headline ?? "",
          bio: agent.bio ?? "",
          license_number: agent.license_number ?? "",
          licensed_states: agent.licensed_states,
          photo_url: agent.photo_url,
        }}
        slug={agent.slug}
        balanceCents={state.balanceCents}
        stripeConnected={integrations.stripe}
        connected={migzReadyFor(agent)}
        plan={{ topics: agent.ad_focus ?? [], batch: state.batch, autoRun: agent.migz_mode === "auto" }}
        creativeMode={agent.creative_mode ?? null}
        creativeCount={state.creativeCount}
        contactEmail={CONTACT_EMAIL}
        completed={state.completed}
      />
    </>
  );
}
