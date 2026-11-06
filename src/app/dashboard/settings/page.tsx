import { requireSetUpAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { AutomatedEmailsLink, CallButtonForm, GhostBookingsForm, MigzModeForm, NotificationSettings } from "@/components/dashboard/SettingsForms";
import { IntentLevelForm, VideoTierForm } from "@/components/dashboard/AdChoices";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier } from "@/lib/ad-options";
import { RoofingForm } from "@/components/dashboard/RoofingForm";
import { isRoofer, DEFAULT_RADIUS_MILES } from "@/lib/verticals";

export default async function SettingsPage() {
  const agent = await requireSetUpAgent();

  return (
    <>
      <PageHeader title="Settings" description="Your booking page options, notifications and your timezone. You sign in with an emailed link, so there is no password to manage." />
      <div className="max-w-2xl space-y-3">
        <MigzModeForm mode={agent.migz_mode} />
        {isRoofer(agent) ? (
          <RoofingForm
            initial={{
              service_area: agent.service_area ?? "",
              state: agent.licensed_states[0] ?? "",
              radius: agent.service_radius_miles ?? DEFAULT_RADIUS_MILES,
              crews: agent.crews ?? 1,
              license: agent.company_license ?? "",
              crm_webhook_url: agent.crm_webhook_url ?? "",
            }}
          />
        ) : (
          <IntentLevelForm level={isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT} blocked={agent.lead_form_blocked ?? null} />
        )}
        <VideoTierForm tier={isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER} />
        <CallButtonForm initial={{ on: !!agent.call_button, phone: agent.call_phone ?? null, hoursOnly: agent.call_hours_only !== false }} />
        <AutomatedEmailsLink on={!!agent.followup_emails} />
        <GhostBookingsForm on={!!agent.ghost_bookings} />
        <NotificationSettings
          initial={{
            slack_user_id: agent.slack_user_id ?? "",
            timezone: agent.timezone,
            digest_hour: agent.digest_hour,
          }}
        />
      </div>
    </>
  );
}
