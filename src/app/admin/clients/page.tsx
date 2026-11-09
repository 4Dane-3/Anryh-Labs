import { PageHead } from "@/components/admin/AdminShell";
import { getAttentionMeetings, getClientsPage, getDueTasks } from "@/lib/crm/data";
import { ClientsView } from "@/components/admin/crm/ClientsView";
import { NeedsMigration } from "@/components/admin/crm/NeedsMigration";
import { DueToday } from "@/components/admin/crm/Tasks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients · Admin" };

export default async function ClientsPage() {
  const { ready, clients, columns, settings } = await getClientsPage();
  const [tasks, attention] = ready ? await Promise.all([getDueTasks(settings.timezone), getAttentionMeetings(settings.timezone)]) : [[], []];
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <PageHead eyebrow="Sales" title="Clients" description={<>Everyone you&apos;re working with or talking to. Add your own columns, keep notes, and schedule meetings they confirm by email.</>} />
      {ready && <DueToday tasks={tasks} meetings={attention} timezone={settings.timezone} />}
      {ready ? <ClientsView clients={clients} columns={columns} settings={settings} /> : <NeedsMigration />}
    </div>
  );
}
