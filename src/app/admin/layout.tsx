import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAnryhAdmin } from "@/lib/auth";

export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Admin · Anryh Labs",
  robots: { index: false, follow: false },
};

// Anryh Labs staff only (ANRYH_ADMIN_EMAILS). Everyone else gets a plain 404.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAnryhAdmin())) notFound();
  return <div className="min-h-screen bg-ink text-fg antialiased [color-scheme:dark]">{children}</div>;
}
