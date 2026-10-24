import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CalendarCheck, Clock, MessageCircle, SearchCheck, ShieldCheck } from "lucide-react";
import { ratingText, Stars } from "@/components/ui/stars";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug, getIntakeQuestions } from "@/lib/booking/data";
import { preBookingQuestions } from "@/lib/booking/questions";
import { BookingWidget } from "@/components/booking/BookingWidget";
import { AboutAgent, StickyBookBar } from "@/components/booking/PageBits";
import { DEFAULT_TITLE } from "@/lib/campaign";
import { pageFont } from "@/lib/booking/page-fonts";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ preview?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return {};
  return {
    title: `Book a free consultation with ${agent.full_name}`,
    description:
      agent.headline ?? `Book a life insurance consultation with ${agent.full_name}.`,
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

export default async function AgentPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const agent = await getAgentBySlug(slug);
  if (!agent) notFound();
  // Embedded in the agent's dashboard: show the real page, but booking is switched off
  const preview = query?.preview === "1";

  const [{ data: testimonials }, questions] = await Promise.all([
    supabaseAdmin
      .from("testimonials")
      .select("id, author_name, author_detail, quote, rating")
      .eq("agent_id", agent.id)
      .eq("published", true)
      .order("sort"),
    getIntakeQuestions(agent.id),
  ]);
  const requiredSteps = agent.required_intake_steps ?? [];

  const firstName = agent.full_name.split(" ")[0];
  const initials = agent.full_name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  const slotMinutes = agent.slot_minutes ?? 30;
  const states = agent.licensed_states;
  const rated = (testimonials ?? []).filter((t) => t.rating);
  const avgRating = rated.length ? rated.reduce((s, t) => s + (t.rating ?? 0), 0) / rated.length : null;
  const font = pageFont(agent.page_font);

  return (
    <div className={`min-h-screen bg-white text-slate-900 ${font.className}`} style={font.style}>
      {/* Booking first: on phones the calendar sits right under who the agent is, before any long text;
          on desktop it's the sticky right column */}
      <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-28 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-x-14 lg:gap-y-8 lg:pb-16 lg:pt-14">
        <header className="min-w-0 lg:col-start-1">
          <div className="flex items-center gap-3">
            {agent.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agent.photo_url}
                alt={agent.full_name}
                crossOrigin="anonymous"
                className="size-14 rounded-full object-cover sm:size-20"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full bg-blue-700 text-xl font-semibold text-white sm:size-20">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight sm:text-3xl">{agent.full_name}</h1>
              <p className="text-sm text-slate-500 sm:text-base">{agent.title || DEFAULT_TITLE}</p>
              {states.length > 0 && (
                <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600">
                  <ShieldCheck className="size-4 shrink-0 text-blue-700" />
                  <span>Licensed in {states.join(", ")}</span>
                </p>
              )}
              {avgRating !== null && (
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
                  <Stars value={avgRating} />
                  <span>{ratingText(Math.round(avgRating * 10) / 10)} · {rated.length} review{rated.length === 1 ? "" : "s"}</span>
                </p>
              )}
            </div>
          </div>

          {agent.headline && (
            <p className="mt-4 line-clamp-3 text-2xl font-bold leading-tight tracking-tight sm:text-4xl lg:mt-8 lg:line-clamp-none">
              {agent.headline}
            </p>
          )}

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-600">
            <li className="flex items-center gap-1.5"><Clock className="size-4 text-blue-700" /> Free {slotMinutes}-min consultation</li>
            <li className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-blue-700" /> No obligation</li>
          </ul>
        </header>

        <aside id="book" className="min-w-0 scroll-mt-4 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-bold sm:text-xl">Book your free consultation with {firstName}</h2>
            <p className="mb-4 mt-0.5 text-sm text-slate-500">Pick a time. It takes under a minute.</p>
            <BookingWidget
              slug={agent.slug}
              firstName={firstName}
              preview={preview}
              questions={preBookingQuestions(questions, requiredSteps)}
              requiredSteps={requiredSteps}
            />
          </div>
        </aside>

        <section className="min-w-0 space-y-10 lg:col-start-1">
          <div>
            <h2 className="text-lg font-semibold">How the consultation works</h2>
            <ul className="mt-4 space-y-4">
              {steps.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                    <Icon className="size-[18px]" />
                  </div>
                  <div>
                    <div className="font-semibold">{title}</div>
                    <div className="text-slate-600">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {!!testimonials?.length && (
            <div>
              <h2 className="text-lg font-semibold">What clients say</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {testimonials.map((t) => (
                  <figure key={t.id} className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200">
                    {t.rating && <Stars value={Number(t.rating)} className="mb-2" />}
                    <blockquote className="text-[15px] leading-relaxed text-slate-700">“{t.quote}”</blockquote>
                    <figcaption className="mt-3 text-sm">
                      <span className="font-medium text-slate-900">{t.author_name}</span>
                      {t.author_detail && <span className="text-slate-500"> · {t.author_detail}</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {agent.bio && <AboutAgent firstName={firstName} bio={agent.bio} preview={preview} />}

        </section>
      </main>

      <StickyBookBar preview={preview} />

      <footer className="mx-auto max-w-5xl px-4 pb-28 text-xs lg:pb-10 leading-relaxed text-slate-400 sm:px-6">
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
