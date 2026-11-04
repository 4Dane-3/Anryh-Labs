import { requireSetUpAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { AutomatedEmails } from "@/components/dashboard/AutomatedEmails";
import { leadEmailSender } from "@/lib/booking/sites";
import { sequencesFor } from "@/lib/email-sequences";

export default async function AutomatedEmailsPage() {
  const agent = await requireSetUpAgent();
  return (
    <>
      <PageHeader
        title="Automated emails"
        description="What a lead gets after you tap Tried to call or Sent an email on their card in Clients: each email's subject and message, how many there are, and how long after the last one each goes out."
      />
      <AutomatedEmails initial={sequencesFor(agent)} on={!!agent.followup_emails} ready={!!process.env.RESEND_API_KEY && !!leadEmailSender(agent.slug)} agentName={agent.full_name} />
    </>
  );
}
