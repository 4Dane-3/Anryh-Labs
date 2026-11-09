import { supabaseAdmin } from "@/lib/supabase-admin";
import { voiceConfigured } from "@/lib/voice/elevenlabs";
import { DemoCallForm } from "@/components/admin/DemoCallForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo call · Admin" };

export default async function DemoCallPage() {
  const { data } = await supabaseAdmin.from("agents").select("id, full_name, timezone").order("full_name");
  const accounts = (data ?? []) as { id: string; full_name: string; timezone: string }[];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Demo call</h1>
        <p className="mt-1 max-w-xl text-sm text-fg-muted">Emma calls the number you enter, right now, as the company you type. Only call someone who has said yes.</p>
      </header>
      <DemoCallForm accounts={accounts} ready={voiceConfigured()} />
    </div>
  );
}
