import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CalendarCheck, Sparkles } from "lucide-react";
import { getAgentBySlug } from "@/lib/booking/data";
import { JoinForm } from "@/components/join/JoinForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const agent = await getAgentBySlug((await params).slug);
  if (!agent) return {};
  return {
    title: `${agent.full_name.split(" ")[0]} invited you to Migz · Anryh Labs`,
    description: "Migz, the AI media buyer from Anryh Labs, runs your Meta ads and books consultations into your calendar. Invite only.",
    robots: { index: false, follow: false },
  };
}

const points = [
  { icon: Sparkles, title: "Migz runs your Meta ads", body: "It writes and tests the ads, reads the results every day and moves your budget to what books calls." },
  { icon: CalendarCheck, title: "Consultations land in your calendar", body: "People who tap your ads book straight onto your own page, at the times you choose." },
  { icon: BadgeCheck, title: "No subscription, no contract", body: "Add funds when you want: 80% goes straight to your ads, and 20% covers Migz." },
];

// The page an agent's invite link opens: who invited you, what Migz is, and a short request form.
// Membership is invite only, so this asks to join; Anryh Labs approves it and sets up the account.
export default async function JoinPage({ params }: Props) {
  const referrer = await getAgentBySlug((await params).slug);
  if (!referrer) notFound();
  const first = referrer.full_name.split(" ")[0];
  const initials = referrer.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* The form right under the intro on phones; the sticky right column on desktop */}
      <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-x-14 lg:gap-y-8 lg:pt-16">
        <header className="min-w-0 lg:col-start-1">
          <div className="flex items-center gap-3">
            {referrer.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={referrer.photo_url} alt={referrer.full_name} crossOrigin="anonymous" className="size-12 rounded-full object-cover" />
            ) : (
              <div className="flex size-12 items-center justify-center rounded-full bg-blue-700 font-semibold text-white">{initials}</div>
            )}
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{referrer.full_name}</span> invited you
            </p>
          </div>
          <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Get more consultations booked, without running ads yourself</h1>
          <p className="mt-3 max-w-xl text-base text-slate-600">
            Migz is the AI media buyer from Anryh Labs, built for insurance agents. Membership is invite only, and {first} has
            invited you. Send your details and Anryh Labs will set up your account.
          </p>
        </header>


        <aside className="min-w-0 lg:sticky lg:top-10 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-bold">Request your invite</h2>
            <p className="mb-4 mt-0.5 text-sm text-slate-500">Takes a minute. Anryh Labs usually replies within a day.</p>
            <JoinForm slug={referrer.slug} referrerFirstName={first} />
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">
            Already a member? <Link href="/login" className="underline">Sign in</Link> ·{" "}
            <Link href="/privacy" className="underline">Privacy policy</Link>
          </p>
        </aside>

        <section className="min-w-0 lg:col-start-1">
          <ul className="space-y-5">
            {points.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                  <Icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-slate-600">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
