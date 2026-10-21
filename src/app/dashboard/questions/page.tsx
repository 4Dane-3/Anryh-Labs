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
        description="The optional questions people answer after they book, to help you prepare for the call. Every question is optional for them."
      />
      <QuestionsEditor initial={questions} usingDefaults={!count} />
    </>
  );
}
