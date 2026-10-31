import { requireAgent } from "@/lib/auth";
import { getAllClients, getCallBacks } from "@/lib/dashboard/queries";
import { CallBacks } from "@/components/dashboard/CallBacks";
import { getIntakeQuestions } from "@/lib/booking/data";
import { PageHeader } from "@/components/dashboard/ui";
import { ClientsTable } from "@/components/dashboard/ClientsTable";
import { getOutcomeItems } from "@/lib/dashboard/outcomes";
import { OutcomeList } from "@/components/dashboard/OutcomeAsk";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const agent = await requireAgent();
  const [{ id }, clients, questions, callBacks, outcomes] = await Promise.all([
    searchParams,
    getAllClients(agent.id),
    getIntakeQuestions(agent.id),
    getCallBacks(agent.id),
    getOutcomeItems(agent),
  ]);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who booked a call with you, with their prep answers and your notes, and the people waiting for a call back."
      />
      <div className="mb-6">
        <OutcomeList
          rows={outcomes}
          timezone={agent.timezone}
          title="How did they go?"
          description="Your calls and leads from the last 2 weeks. One tap each, and change it any time: Migz scores your ads on who shows up and buys."
        />
      </div>
      <CallBacks rows={callBacks} timezone={agent.timezone} />
      <ClientsTable
        clients={clients}
        timezone={agent.timezone}
        initialId={id ?? null}
        questionOrder={questions.map((q) => q.key)}
      />
    </>
  );
}
