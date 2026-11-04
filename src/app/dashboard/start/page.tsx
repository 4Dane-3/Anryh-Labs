import { requireAgent } from "@/lib/auth";
import { CONTACT_EMAIL } from "@/lib/contact";
import { integrations, migzReadyFor } from "@/lib/integrations";
import { getSetupState } from "@/lib/dashboard/setup";
import { StartWizard } from "@/components/dashboard/start/StartWizard";
import { PageHeader } from "@/components/dashboard/ui";
import { getCampaignStart } from "@/lib/dashboard/campaign-plan";
import { getFundsAddedCents } from "@/lib/dashboard/queries";
import { displayPhone } from "@/lib/booking/call";
import { landingUrl } from "@/lib/booking/sites";
import { META_BUSINESS_ID } from "@/lib/meta/access";
import { topUpDefaults } from "@/lib/auto-top-up";

export const dynamic = "force-dynamic";

// What Stripe's return links say, shown above the steps
const RETURNS: Record<string, { text: string; good: boolean }> = {
  "setup_fee:paid": { text: "Setup fee paid, thank you. Step 3 ticks off as soon as Stripe confirms it, usually within a few seconds; refresh if it hasn't yet.", good: true },
  "setup_fee:canceled": { text: "No payment was made. Pay the setup fee whenever you're ready: it's step 3.", good: false },
  "deposit:success": { text: "Payment received. Your balance updates as soon as Stripe confirms it, usually within a few seconds; refresh if it hasn't yet.", good: true },
  "deposit:canceled": { text: "No payment was made. You can add funds whenever you're ready.", good: false },
};

export default async function StartPage({ searchParams }: { searchParams: Promise<{ setup_fee?: string; deposit?: string }> }) {
  const [agent, query] = await Promise.all([requireAgent(), searchParams]);
  const [state, start, fundsAdded] = await Promise.all([getSetupState(agent), getCampaignStart(agent), getFundsAddedCents(agent.id)]);
  const back = RETURNS[query.setup_fee ? `setup_fee:${query.setup_fee}` : `deposit:${query.deposit}`];

  return (
    <>
      <PageHeader
        title={state.completed ? "Setup" : "Start here"}
        description={
          state.completed
            ? "Everything you need to run your first campaign, in order. Migz handles the rest."
            : "Finish these steps to start your first campaign. The rest of your dashboard opens once it starts."
        }
      />
      {back && (
        <p className={`mb-6 max-w-3xl rounded-lg border px-4 py-3 text-[13px] ${back.good ? "border-good/30 bg-good/10 text-fg" : "border-line bg-ink-raised text-fg-muted"}`}>{back.text}</p>
      )}
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
          partner_carriers: agent.partner_carriers ?? [],
        }}
        slug={agent.slug}
        balanceCents={state.balanceCents}
        fundsAddedCents={fundsAdded}
        setupFeePaidAt={agent.setup_fee_paid_at ?? null}
        stripeConnected={integrations.stripe}
        connected={migzReadyFor(agent)}
        plan={{
          topics: agent.ad_focus ?? [],
          batch: state.batch,
          start: start.initial,
          own: start.own,
          fundsNeeded: state.fundsNeeded,
        }}
        creativeMode={agent.creative_mode ?? null}
        creativeCount={state.creativeCount}
        contactEmail={CONTACT_EMAIL}
        completed={state.completed}
        business={{
          agency_name: agent.agency_name ?? "",
          npn: agent.npn ?? "",
          business_email: agent.business_email || agent.email,
          phone: agent.call_phone ? displayPhone(agent.call_phone) : "",
        }}
        meta={{
          businessId: META_BUSINESS_ID,
          linked: agent.meta_ad_account_id && agent.meta_page_id ? { adAccount: agent.meta_ad_account_id, page: agent.meta_page_id } : null,
          requested: {
            adAccount: agent.meta_ad_account_requested?.replace(/^act_/, "") ?? "",
            page: agent.meta_page_requested ?? "",
            at: agent.meta_access_requested_at ?? null,
          },
        }}
        booking={{
          choice: agent.booking_choice ?? null,
          ownUrl: agent.own_booking_url ?? "",
          pageUrl: landingUrl(agent.slug),
          hoursMissing: !state.hasHours,
        }}
        slack={{ current: agent.slack_user_id ?? "", inviteUrl: process.env.SLACK_INVITE_URL || null }}
        autoTopUp={
          integrations.stripe
            ? {
                on: !!agent.auto_topup,
                card: agent.auto_topup_card ?? null,
                amountCents: agent.auto_topup_amount_cents ?? topUpDefaults(agent.daily_budget_cents).amountCents,
                belowCents: agent.auto_topup_below_cents ?? topUpDefaults(agent.daily_budget_cents).belowCents,
                error: agent.auto_topup_error ?? null,
                addedBeforeCents: fundsAdded,
                dailyCents: start.initial.dailyCents,
              }
            : null
        }
        migzMode={agent.migz_mode_chosen_at ? (agent.migz_mode === "auto" ? "auto" : "approve") : null}
      />
    </>
  );
}
