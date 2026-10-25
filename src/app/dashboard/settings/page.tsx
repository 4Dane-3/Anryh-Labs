import { requireAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { CallButtonForm, GhostBookingsForm, MigzModeForm, NotificationSettings } from "@/components/dashboard/SettingsForms";

export default async function SettingsPage() {
  const agent = await requireAgent();

  return (
    <>
      <PageHeader title="Settings" description="Your booking page options, notifications and your timezone. You sign in with an emailed link, so there is no password to manage." />
      <div className="max-w-2xl space-y-3">
        <MigzModeForm mode={agent.migz_mode} />
        <CallButtonForm initial={{ on: !!agent.call_button, phone: agent.call_phone ?? null, hoursOnly: agent.call_hours_only !== false }} />
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
