import { requireSetUpAgent } from "@/lib/auth";
import { getIntakeQuestions } from "@/lib/booking/data";
import { PageHeader } from "@/components/dashboard/ui";
import { ClientsTable } from "@/components/dashboard/ClientsTable";
import { getClients } from "@/lib/dashboard/clients";
import { leadEmailSender } from "@/lib/booking/sites";
import { sequencesFor } from "@/lib/email-sequences";
import { isRoofer } from "@/lib/verticals";
import { rulesOf } from "@/lib/roofing/fit";
import { describeRules } from "@/lib/roofing/job-rules";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const agent = await requireSetUpAgent();
  const [{ id }, clients, questions] = await Promise.all([searchParams, getClients(agent.id), getIntakeQuestions(agent.id)]);
  // ?id= opens a card: "call:<id>" or "lead:<id>" (older links carry a bare booking id); a lead who booked opens the call's card
  const [kind, recordId] = id?.includes(":") ? id.split(":") : ["call", id];
  const sequences = sequencesFor(agent);
  const emailing = {
    on: !!agent.followup_emails,
    ready: !!process.env.RESEND_API_KEY && !!leadEmailSender(agent.slug),
    sequences: {
      tried_call: { on: sequences.tried_call.on, total: sequences.tried_call.emails.length },
      emailed: { on: sequences.emailed.on, total: sequences.emailed.emails.length },
    },
  };
  const initialKey = recordId ? (clients.find((c) => c.subjects.some((s) => s.kind === kind && s.id === recordId))?.key ?? null) : null;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone who reached you: leads from Migz (instant forms, quote requests, booked calls) and personal clients you add yourself. Open someone to log your calls, add notes, and mark them sold or not interested. Migz and Meta learn from what you mark on Migz leads."
      />
      <ClientsTable clients={clients} timezone={agent.timezone} initialKey={initialKey} questionOrder={questions.map((q) => q.key)} emailing={emailing} ruleLines={isRoofer(agent) ? describeRules(rulesOf(agent)) : undefined} />
    </>
  );
}
