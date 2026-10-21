import { requireAgent } from "@/lib/auth";
import { getAllClients } from "@/lib/dashboard/queries";
import { getIntakeQuestions } from "@/lib/booking/data";
import { PageHeader } from "@/components/dashboard/ui";
import { ClientsTable } from "@/components/dashboard/ClientsTable";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const agent = await requireAgent();
  const [{ id }, clients, questions] = await Promise.all([
    searchParams,
    getAllClients(agent.id),
    getIntakeQuestions(agent.id),
  ]);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who booked a call with you, with their prep answers and your notes."
      />
      <ClientsTable
        clients={clients}
        timezone={agent.timezone}
        initialId={id ?? null}
        questionOrder={questions.map((q) => q.key)}
      />
    </>
  );
}
