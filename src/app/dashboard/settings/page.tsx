import { requireSetUpAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { AutomatedEmailsLink, CallButtonForm, GhostBookingsForm, MigzModeForm, NotificationSettings, VoiceAgentForm } from "@/components/dashboard/SettingsForms";
import { checkinConfigured, voiceConfigured } from "@/lib/voice/elevenlabs";
import { JobRulesPanel } from "@/components/dashboard/JobRules";
import { rulesOf } from "@/lib/roofing/fit";
import { CheckinSettingsForm } from "@/components/dashboard/Referrals";
import { IntentLevelForm, VideoTierForm } from "@/components/dashboard/AdChoices";
import { DEFAULT_INTENT, DEFAULT_VIDEO_TIER, isIntentLevel, isVideoTier } from "@/lib/ad-options";
import { RoofingForm } from "@/components/dashboard/RoofingForm";
import { isRoofer, radiusMiles } from "@/lib/verticals";

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
              radius: radiusMiles(agent),
              crews: agent.crews ?? 1,
              license: agent.company_license ?? "",
              crm_webhook_url: agent.crm_webhook_url ?? "",
            }}
          />
        ) : (
          <IntentLevelForm level={isIntentLevel(agent.intent_level) ? agent.intent_level : DEFAULT_INTENT} blocked={agent.lead_form_blocked ?? null} />
        )}
        <VideoTierForm tier={isVideoTier(agent.video_tier) ? agent.video_tier : DEFAULT_VIDEO_TIER} />
        {isRoofer(agent) && <JobRulesPanel initial={rulesOf(agent)} />}
        <VoiceAgentForm on={!!agent.voice_agent} ready={voiceConfigured()} roof={isRoofer(agent)} />
        {isRoofer(agent) && (
          <CheckinSettingsForm
            initial={{
              on: !!agent.checkin_calls,
              rewardCents: agent.referral_reward_cents ?? 10000,
              goal: agent.referral_goal ?? 5,
              introEmail: !!agent.referral_intro_email,
              mailingAddress: agent.mailing_address ?? "",
              googleReviewUrl: agent.google_review_url ?? "",
            }}
            ready={checkinConfigured()}
            webhook={agent.job_webhook_token ? { url: `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/jobs/completed`, secret: agent.job_webhook_token } : null}
          />
        )}
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
