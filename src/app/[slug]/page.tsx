import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, MessageCircle, SearchCheck, ShieldCheck } from "lucide-react";
import { getAgentBySlug } from "@/lib/booking/data";
import { BookingWidget } from "@/components/booking/BookingWidget";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return {};
  return {
    title: `Book a free call with ${agent.full_name}`,
    description:
      agent.headline ?? `Book a life insurance call with ${agent.full_name}.`,
  };
}

const steps = [
  {
    icon: MessageCircle,
    title: "Tell me what you want to protect",
    body: "Your family, your mortgage, your final expenses. We start with your goals.",
  },
  {
    icon: SearchCheck,
    title: "Already have a policy? Make sure you're not overpaying",
    body: "I'll review your current plan and compare it with other carriers to see if you can get the same coverage for less.",
  },
  {
    icon: ShieldCheck,
    title: "See options that fit your budget",
    body: "Straight answers on coverage and cost, with no jargon.",
  },
  {
    icon: CalendarCheck,
    title: "No pressure, no obligation",
    body: "It's a conversation. You decide what, if anything, makes sense.",
  },
];

export default async function AgentPage({ params }: Props) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) notFound();

  const firstName = agent.full_name.split(" ")[0];
  const initials = agent.full_name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_420px] lg:gap-14 lg:py-16">
        <section>
          <div className="flex items-center gap-4">
            {agent.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agent.photo_url}
                alt={agent.full_name}
                crossOrigin="anonymous"
                className="size-20 rounded-full object-cover ring-4 ring-white sm:size-24"
              />
            ) : (
              <div className="flex size-20 items-center justify-center rounded-full bg-blue-700 text-2xl font-semibold text-white ring-4 ring-white sm:size-24">
                {initials}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{agent.full_name}</h1>
              <p className="text-slate-500">Licensed life insurance agent</p>
            </div>
          </div>

          {agent.headline && (
            <h2 className="mt-8 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {agent.headline}
            </h2>
          )}
          {agent.bio && (
            <p className="mt-4 text-lg leading-relaxed text-slate-600">{agent.bio}</p>
          )}

          {agent.licensed_states.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">Licensed in</span>
              {agent.licensed_states.map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-white px-2 py-0.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <ul className="mt-10 space-y-5">
            {steps.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                  <Icon className="size-5" />
                </div>
                <div>
                  <div className="font-semibold">{title}</div>
                  <div className="text-slate-600">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-xl font-bold">Book a free call with {firstName}</h2>
            <p className="mb-5 mt-1 text-sm text-slate-500">
              Pick a time that works for you.
            </p>
            <BookingWidget slug={agent.slug} firstName={firstName} />
          </div>
        </aside>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs leading-relaxed text-slate-400 sm:px-6">
        <p>
          {agent.full_name} is a licensed insurance agent
          {agent.license_number ? ` (License #${agent.license_number})` : ""}.
          Coverage availability and pricing depend on underwriting and are not
          guaranteed. This site does not offer a contract of insurance.{" "}
          <Link href="/privacy" className="underline">
            Privacy policy
          </Link>
        </p>
      </footer>
    </div>
  );
}
