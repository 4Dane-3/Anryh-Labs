import type { Metadata } from "next";
import { requireAgent, devAgentSlug } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/Sidebar";

export const metadata: Metadata = {
  title: "Agent dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const agent = await requireAgent();

  return (
    <div className="min-h-screen bg-ink text-fg antialiased [color-scheme:dark] lg:pl-60">
      <Sidebar
        agent={{ name: agent.full_name, slug: agent.slug, photoUrl: agent.photo_url }}
        devLogin={!!devAgentSlug()}
      />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-8 lg:pt-10">{children}</main>
    </div>
  );
}
