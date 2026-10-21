import { requireAgent } from "@/lib/auth";
import { getBrainBoard, getBrainLive } from "@/lib/migz/brain";
import { BrainView } from "@/components/dashboard/brain/BrainView";
import { PageHeader } from "@/components/dashboard/ui";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const agent = await requireAgent();
  const [live, board] = await Promise.all([getBrainLive(agent), getBrainBoard(agent)]);
  return (
    <>
      <PageHeader
        title="Migz brain"
        description="How Migz runs your ads: Sonnet leads each review, a Haiku crew audits and researches, and Opus advises before anything that touches your spend. Everything here comes from real activity."
      />
      <BrainView initial={live} board={JSON.parse(JSON.stringify(board))} agentId={agent.id} />
    </>
  );
}
