import { requireAgent, devAgentSlug } from "@/lib/auth";
import { integrations } from "@/lib/integrations";
import { PageHeader, Panel, PanelHeader } from "@/components/dashboard/ui";
import { NotificationSettings, PasswordForm } from "@/components/dashboard/SettingsForms";
import { cn } from "@/lib/utils";

const SERVICES = [
  { key: "slack", name: "Slack", detail: "Booking alerts and your morning summary" },
  { key: "meta", name: "Meta ads", detail: "Lets Migz AI run your campaigns and adjust them" },
  { key: "stripe", name: "Stripe", detail: "Adding funds for your ads" },
] as const;

export default async function SettingsPage() {
  const agent = await requireAgent();

  return (
    <>
      <PageHeader title="Settings" description="Notifications, your timezone and your account." />
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <NotificationSettings
            initial={{
              slack_user_id: agent.slack_user_id ?? "",
              timezone: agent.timezone,
              digest_hour: agent.digest_hour,
            }}
          />
          <PasswordForm email={agent.email} devLogin={!!devAgentSlug()} />
        </div>

        <Panel className="h-fit lg:col-span-2">
          <PanelHeader title="Connections" description="Set up by your account manager." />
          <ul className="divide-y divide-line">
            {SERVICES.map((s) => {
              const on = integrations[s.key];
              return (
                <li key={s.key} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-good" : "bg-fg-faint")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{s.name}</p>
                    <p className="text-[12px] text-fg-faint">{s.detail}</p>
                  </div>
                  <span className={cn("text-[12px]", on ? "text-good" : "text-fg-faint")}>
                    {on ? "Connected" : "Not connected"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
