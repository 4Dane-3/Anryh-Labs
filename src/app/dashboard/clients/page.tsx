import { requireAgent } from "@/lib/auth";
import { getIntakeQuestions } from "@/lib/booking/data";
import { PageHeader } from "@/components/dashboard/ui";
import { ClientsTable } from "@/components/dashboard/ClientsTable";
import { getClients } from "@/lib/dashboard/clients";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const agent = await requireAgent();
  const [{ id }, clients, questions] = await Promise.all([searchParams, getClients(agent.id), getIntakeQuestions(agent.id)]);
  // ?id= opens a card: "call:<id>" or "lead:<id>" (older links carry a bare booking id); a lead who booked opens the call's card
  const [kind, recordId] = id?.includes(":") ? id.split(":") : ["call", id];
  const initialKey = recordId ? (clients.find((c) => c.subjects.some((s) => s.kind === kind && s.id === recordId))?.key ?? null) : null;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who reached you: instant-form leads, quote requests and booked calls. Open someone to log your calls, add notes, and mark them sold or not interested. Migz and Meta learn from what you mark."
      />
      <ClientsTable clients={clients} timezone={agent.timezone} initialKey={initialKey} questionOrder={questions.map((q) => q.key)} />
    </>
  );
}
