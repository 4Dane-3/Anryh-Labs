import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkinConfigured, voiceConfigured } from "@/lib/voice/elevenlabs";
import { DemoCallForm } from "@/components/admin/DemoCallForm";
import { PageHead } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo calls · Admin" };

export default async function DemoCallPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const { data } = await supabaseAdmin.from("agents").select("id, full_name, timezone").order("full_name");
  const accounts = (data ?? []) as { id: string; full_name: string; timezone: string }[];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-16 pt-6 sm:px-8">
      <PageHead eyebrow="Voice" title="Demo calls" description="Emma calls the number you enter, right now, as the company you type. Only call someone who has said yes." />
      <DemoCallForm accounts={accounts} ready={voiceConfigured()} checkinReady={checkinConfigured()} initialKind={sp.kind === "checkin" ? "checkin" : "lead"} />
    </div>
  );
}
