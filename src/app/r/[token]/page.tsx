import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gift, ShieldCheck } from "lucide-react";
import { getReferralPage } from "@/lib/roofing/referrals";
import { dollars } from "@/lib/voice/checkin-rules";
import { ReferralForm } from "@/components/booking/ReferralForm";

// A customer's referral page, from the link in their check-in email: up to N friends (name, phone, email,
// address), with progress toward the gift card. Same look as the roofer's booking page.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ReferralPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await getReferralPage(token);
  if (!page) notFound();
  const reward = page.rewardCents > 0 ? dollars(page.rewardCents) : null;
  const initials = page.company.split(" ").map((w) => w[0]).slice(0, 2).join("");

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <header className="flex items-center gap-3">
          {page.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.photoUrl} alt={page.company} crossOrigin="anonymous" className="size-14 rounded-full object-cover" />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-full bg-blue-700 text-xl font-semibold text-white">{initials}</div>
          )}
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight sm:text-xl">{page.company}</p>
            {page.license && (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600">
                <ShieldCheck className="size-4 shrink-0 text-blue-700" /> License #{page.license}
              </p>
            )}
          </div>
        </header>

        <h1 className="mt-8 text-2xl font-bold leading-tight tracking-tight sm:text-4xl">
          {page.customerFirstName ? `Thanks, ${page.customerFirstName}! ` : "Thank you! "}
          {reward ? `Refer ${page.goal} friends, get a ${reward} gift card.` : "Know someone who needs a roofer?"}
        </h1>
        <p className="mt-3 text-slate-600">
          {reward
            ? `Add friends, family or neighbors who might need roofing work. Once ${page.goal} are in, we'll send you a ${reward} gift card to any store you choose.`
            : "Add friends, family or neighbors who might need roofing work, and we'll reach out."}{" "}
          We&apos;ll only contact them about roofing, with a call from our team.
        </p>

        {reward && (
          <div className="mt-6 flex items-center gap-2 text-sm font-medium text-blue-800">
            <Gift className="size-4" /> {page.earned ? `You've earned the ${reward} gift card. We'll be in touch!` : `${page.referred.length} of ${page.goal} so far`}
          </div>
        )}

        <ReferralForm token={token} goal={page.goal} already={page.referred.map((r) => r.name)} reward={reward} />

        <p className="mt-10 text-xs leading-relaxed text-slate-400">
          {page.company} uses these details only to contact the people you refer about roofing. They won&apos;t get automated calls or texts.
          {reward ? " Gift cards are sent by the company once all referrals are in; existing customers or people already in touch with us don't count toward the total." : ""}
        </p>
      </main>
    </div>
  );
}
