import type { Metadata } from "next";
import { LoginForm } from "@/components/dashboard/LoginForm";
import { GlassBackdrop } from "@/components/glass/GlassBackdrop";

export const metadata: Metadata = {
  title: "Sign in · Agent dashboard",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink px-4 text-fg [color-scheme:dark]">
      <GlassBackdrop tone="dim" />
      <div className="relative w-full max-w-md">
        <LoginForm linkError={error === "link"} noAccount={error === "noaccount"} />
      </div>
    </div>
  );
}
