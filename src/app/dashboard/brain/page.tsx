import { requireAgent } from "@/lib/auth";
import { getBrainBoard, getBrainLive } from "@/lib/migz/brain";
import { BrainView } from "@/components/dashboard/brain/BrainView";
import { PageHeader } from "@/components/dashboard/ui";
import { getProposedActions } from "@/lib/dashboard/queries";
import { PageAnalyticsPanel } from "@/components/admin/PageAnalytics";
import { landingUrl } from "@/lib/booking/sites";
import { JumpTabs } from "@/components/dashboard/JumpTabs";

const SECTIONS = [
  { id: "approvals", label: "Waiting for OK" },
  { id: "brain-overview", label: "Overview" },
  { id: "brain-live", label: "Live" },
  { id: "brain-page", label: "Page visits" },
  { id: "brain-scorecards", label: "Scorecards" },
  { id: "brain-log", label: "Session log" },
  { id: "brain-auditor", label: "Auditor" },
  { id: "brain-notebook", label: "Notebook" },
  { id: "brain-experiments", label: "Experiments" },
  { id: "brain-learnings", label: "Learnings" },
  { id: "brain-swipes", label: "Swipe file" },
];

export const dynamic = "force-dynamic";

export default async function BrainPage({ searchParams }: { searchParams: Promise<{ started?: string }> }) {
  const { started } = await searchParams;
  const agent = await requireAgent();
  const [live, board, proposals] = await Promise.all([getBrainLive(agent), getBrainBoard(agent), getProposedActions(agent.id)]);
  return (
    <>
      <PageHeader
        title="Migz AI Brain"
        description="How Migz AI runs your ads: Sonnet leads each review, a Haiku crew audits and researches, and Opus advises before anything that touches your spend. Everything here comes from real activity."
      />
      <JumpTabs sections={SECTIONS} />
      <BrainView
        initial={live}
        board={JSON.parse(JSON.stringify(board))}
        agentId={agent.id}
        justStarted={started === "1"}
        approvals={agent.migz_mode === "approve" || proposals.length ? JSON.parse(JSON.stringify(proposals)) : null}
        // What the ads' visitors do on the page (their partner-site page when they have one): what Migz reads too
        pageAnalytics={<PageAnalyticsPanel mine={{ pageUrl: landingUrl(agent.slug) }} />}
      />
    </>
  );
}
