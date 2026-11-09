import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/crm/data";
import { clientByEmailToken, unsubscribe } from "@/lib/crm/unsubscribe";
import { SubmitButton } from "@/app/meet/[token]/SubmitButton";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// Where a follow-up email's Unsubscribe link lands: one button (a POST, so link scanners can't press it),
// then a confirmation. White and slate, like the other pages clients see.
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [c, settings] = await Promise.all([clientByEmailToken(token), getSettings()]);
  if (!c) notFound();
  async function confirm() {
    "use server";
    await unsubscribe(token);
    revalidatePath(`/unsubscribe/${token}`);
  }
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900 [color-scheme:light] sm:py-20">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-medium text-slate-500">{settings.from_name}</p>
        {c.unsubscribed_at ? (
          <>
            <h1 className="mt-3 text-2xl font-bold tracking-tight">You&apos;re unsubscribed.</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">You won&apos;t get any more follow-up emails from {settings.from_name}. If you ever want to talk, just reply to one of our emails.</p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-bold tracking-tight">Stop these emails?</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Press the button and {settings.from_name} won&apos;t send you any more follow-up emails.</p>
            <form action={confirm} className="mt-6">
              <SubmitButton pendingLabel="One moment…" className="w-full rounded-full bg-slate-900 px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-slate-800 active:scale-[0.99]">
                Unsubscribe
              </SubmitButton>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
