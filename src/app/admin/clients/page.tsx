import { getClientsPage } from "@/lib/crm/data";
import { ClientsView } from "@/components/admin/crm/ClientsView";
import { NeedsMigration } from "@/components/admin/crm/NeedsMigration";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients · Admin" };

export default async function ClientsPage() {
  const { ready, clients, columns, settings } = await getClientsPage();
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="mt-1 max-w-xl text-sm text-fg-muted">Everyone you&apos;re working with or talking to. Add your own columns, keep notes, and schedule meetings they confirm by email.</p>
      </header>
      {ready ? <ClientsView clients={clients} columns={columns} settings={settings} /> : <NeedsMigration />}
    </div>
  );
}
