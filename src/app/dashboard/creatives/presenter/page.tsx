import { requireAgent } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/ui";
import { PresenterSetup } from "@/components/dashboard/PresenterSetup";
import { BrandSetup } from "@/components/dashboard/BrandSetup";
import { creativeSetup } from "@/lib/dashboard/creative-setup";
import { CreativeContext } from "@/components/dashboard/CreativeContext";
import { Panel } from "@/components/dashboard/ui";

export const dynamic = "force-dynamic";

export default async function PresenterPage() {
  const agent = await requireAgent();
  const { brand, presenter, context } = await creativeSetup(agent);
  return (
    <>
      <PageHeader title="You in your videos" description="Owner-on-camera ads with big captions, your towns and brand, and a clear call to action. Nothing goes live until you approve it." />
      <div className="max-w-2xl space-y-5">
        <BrandSetup initial={brand} />
        <PresenterSetup initial={presenter} />
        <Panel className="space-y-4 p-5">
          <p className="font-semibold text-fg">Ad Creative AI Context</p>
          <CreativeContext initial={context} />
        </Panel>
      </div>
    </>
  );
}
