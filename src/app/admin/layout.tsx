import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAnryhAdmin } from "@/lib/auth";
import { AdminTopBar } from "@/components/admin/AdminShell";
import { GlassBackdrop } from "@/components/glass/GlassBackdrop";

export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Admin · Anryh Labs",
  robots: { index: false, follow: false },
};

// Anryh Labs staff only (ANRYH_ADMIN_EMAILS). Everyone else gets a plain 404.
// The same frosted glass as the agent dashboard, in deep orange over a red and amber backdrop (.admin-theme).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAnryhAdmin())) notFound();
  return (
    <div className="admin-theme relative min-h-screen bg-ink text-fg antialiased [color-scheme:dark]">
      <GlassBackdrop tone="ember" />
      <AdminTopBar />
      <main className="relative">{children}</main>
    </div>
  );
}
