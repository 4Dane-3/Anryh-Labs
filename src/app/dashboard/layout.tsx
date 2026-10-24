import type { Metadata } from "next";
import { requireAgent, devAgentSlug, getViewAs, isAnryhAdmin } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { UpdateNotice } from "@/components/dashboard/UpdateNotice";

// Server actions run here too; "Review now" runs a full Migz review (Meta sync + Claude)
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Agent dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [agent, viewing, staff] = await Promise.all([requireAgent(), getViewAs(), isAnryhAdmin()]);

  return (
    <div className="min-h-screen bg-ink text-fg antialiased [color-scheme:dark] lg:pl-60">
      <Sidebar
        agent={{ name: agent.full_name, slug: agent.slug, photoUrl: agent.photo_url }}
        devLogin={!!devAgentSlug()}
        setupDone={!!agent.onboarding_completed_at}
        staff={staff && !viewing}
      />
      <UpdateNotice version={process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev"} />
      {viewing && (
        <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-brand/30 bg-[#2a1d0f]/95 px-4 py-2 text-[13px] backdrop-blur sm:px-8">
          <p className="text-fg">
            <span className="font-semibold text-brand">Viewing as {viewing.full_name}</span>
            <span className="text-fg-muted"> · exactly what they see, live · view only, nothing you click changes their account</span>
          </p>
          {/* A plain link, not <Link>: this URL ends the view, and Next.js prefetches <Link>s in production */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/admin/view/exit" className="rounded-md bg-brand px-2.5 py-1 text-[12px] font-semibold text-brand-fg hover:bg-brand/90">
            Back to admin
          </a>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-8 lg:pt-10">{children}</main>
    </div>
  );
}
