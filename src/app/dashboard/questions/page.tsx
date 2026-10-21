import { requireAgent } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getIntakeQuestions } from "@/lib/booking/data";
import { PageHeader } from "@/components/dashboard/ui";
import { QuestionsEditor } from "@/components/dashboard/QuestionsEditor";

export default async function QuestionsPage() {
  const agent = await requireAgent();
  const [questions, { count }] = await Promise.all([
    getIntakeQuestions(agent.id),
    supabaseAdmin.from("intake_questions").select("key", { count: "exact", head: true }).eq("agent_id", agent.id),
  ]);

  return (
    <>
      <PageHeader
        title="Questions"
        description="What people answer to help you prepare for the call. Mark a question or a whole step as required and it's asked before they can confirm the booking; everything else is optional and asked after they book."
      />
      <QuestionsEditor initial={questions} initialRequiredSteps={agent.required_intake_steps ?? []} usingDefaults={!count} />
    </>
  );
}
