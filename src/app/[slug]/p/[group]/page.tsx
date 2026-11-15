import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { Stars } from "@/components/ui/stars";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug, getIntakeQuestions, type Agent } from "@/lib/booking/data";
import { preBookingQuestions } from "@/lib/booking/questions";
import { BookingWidget } from "@/components/booking/BookingWidget";
import { CallNow, StickyBookBar } from "@/components/booking/PageBits";
import { callButtonShows, displayPhone } from "@/lib/booking/call";
import { areaLabel, isRoofer } from "@/lib/verticals";
import { withRuleQuestions } from "@/lib/roofing/job-rules";
import { rulesOf } from "@/lib/roofing/fit";
import { adGroupPlans } from "@/lib/google-ads/playbook";
import { planFacts } from "@/lib/google-ads/build";
import { groupByPath } from "@/lib/landing/groups";
import { landingCopy } from "@/lib/landing/copy";

// One Google ad group's landing page, in the roofer's own look, on their own ad address
// (book.theirroofing.com/roof-replacement rewrites here). Not for search engines: it's where an ad lands.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; group: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

type Brand = {
  website: string | null;
  logo_path: string | null;
  heading_font: string | null;
  body_font: string | null;
  background: string | null;
  text_color: string | null;
  accent: string | null;
  deals: string[] | null;
  certifications: string[] | null;
  warranties: string[] | null;
  license: string | null;
};

async function load(slug: string, path: string) {
  const group = groupByPath(path);
  const agent = await getAgentBySlug(slug);
  if (!group || !agent || !isRoofer(agent)) return null;
  const { data } = await supabaseAdmin.from("agent_brand").select("website, logo_path, heading_font, body_font, background, text_color, accent, deals, certifications, warranties, license").eq("agent_id", agent.id).maybeSingle();
  const brand = (data as Brand | null) ?? null;
  const facts = planFacts(agent, brand ? { deals: brand.deals ?? [], certifications: brand.certifications ?? [], warranties: brand.warranties ?? [] } : null);
  // Only the jobs they take have a page, the same as their ad groups
  const plan = adGroupPlans(facts).find((p) => p.key === group.key);
  if (!plan) return null;
  const copy = landingCopy(
    group.key,
    { headline: plan.headlines[0], description: plan.descriptions[0] },
    {
      company: facts.company,
      city: facts.city,
      area: agent.service_area ? areaLabel(agent) : null,
      offer: facts.offer,
      special: facts.special,
      certification: facts.certification,
      warranty: facts.warranty,
      license: brand?.license ?? agent.company_license ?? null,
      emergencies: facts.rules?.emergencies ?? true,
    },
  );
  return { agent, brand, copy, special: facts.special };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, group } = await params;
  const page = await load(slug, group);
  if (!page) return {};
  return { title: `${page.copy.title} | ${page.agent.full_name}`, description: page.copy.subhead, robots: { index: false, follow: false } };
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (c: string | null | undefined, fallback: string) => (c && HEX.test(c) ? c : fallback);
/** Black or white, whichever reads on the colour. */
function onColor(c: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#111111" : "#ffffff";
}
const fontStack = (f: string | null | undefined) => (f ? `'${f.replace(/'/g, "")}', ui-sans-serif, system-ui, sans-serif` : "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif");

async function signed(path: string | null | undefined) {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 24 * 3600);
  return data?.signedUrl ?? null;
}

export default async function LandingPage({ params, searchParams }: Props) {
  const [{ slug, group }, query] = await Promise.all([params, searchParams]);
  const page = await load(slug, group);
  if (!page) notFound();
  const { agent, brand, copy, special } = page;
  const preview = query?.preview === "1";

  const [{ data: testimonials }, questions, { data: hours }, { data: presenter }] = await Promise.all([
    supabaseAdmin.from("testimonials").select("id, author_name, author_detail, quote, rating").eq("agent_id", agent.id).eq("published", true).order("sort").limit(6),
    getIntakeQuestions(agent.id),
    supabaseAdmin.from("availability_rules").select("weekday, start_time, end_time").eq("agent_id", agent.id),
    supabaseAdmin.from("agent_presenters").select("job_photo_paths").eq("agent_id", agent.id).maybeSingle(),
  ]);
  const [logo, photo] = await Promise.all([
    signed(brand?.logo_path ?? (agent as Agent & { ad_logo_path?: string | null }).ad_logo_path),
    signed((presenter as { job_photo_paths?: string[] } | null)?.job_photo_paths?.[0]),
  ]);
  const call = callButtonShows(agent, hours ?? []) && agent.call_phone ? { phone: agent.call_phone, firstName: agent.full_name } : null;
  const requiredSteps = agent.required_intake_steps ?? [];

  // Their look: colours and fonts read from their website (Start here → your brand)
  const accent = hex(brand?.accent, "#1d4ed8");
  const band = hex(brand?.background, "#ffffff");
  // The page body is white, so their text colour is used only when it reads on white (a dark site's light text doesn't)
  const brandInk = hex(brand?.text_color, "#0f172a");
  const ink = onColor(brandInk) === "#ffffff" ? brandInk : "#0f172a";
  const fonts = [brand?.heading_font, brand?.body_font].filter((f, i, a): f is string => !!f && a.indexOf(f) === i);
  const fontHref = fonts.length ? `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700;800`).join("&")}&display=swap` : null;
  const vars = { "--lp-accent": accent, "--lp-on-accent": onColor(accent), "--lp-ink": ink, "--lp-band": band, "--lp-on-band": onColor(band) === "#ffffff" ? "#ffffff" : ink } as React.CSSProperties;
  const heading = { fontFamily: fontStack(brand?.heading_font) };

  return (
    <div className="min-h-screen bg-white" style={{ ...vars, color: "var(--lp-ink)", fontFamily: fontStack(brand?.body_font) }}>
      {fontHref && <link rel="stylesheet" href={fontHref} crossOrigin="anonymous" precedence="default" />}

      <header className="border-b border-black/5" style={{ background: "var(--lp-band)", color: "var(--lp-on-band)" }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={agent.full_name} crossOrigin="anonymous" className="h-10 w-auto max-w-[200px] object-contain sm:h-12" />
          ) : (
            <span className="text-lg font-bold sm:text-xl" style={heading}>{agent.full_name}</span>
          )}
          {call && (
            <a href={`tel:${call.phone}`} className="text-sm font-semibold underline-offset-4 hover:underline">
              {displayPhone(call.phone)}
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-28 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-x-14 lg:pb-16 lg:pt-12">
        <section className="min-w-0 lg:col-start-1">
          {special && (
            <p className="mb-3 inline-block rounded-full px-3 py-1 text-sm font-semibold" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>
              {special}
            </p>
          )}
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl" style={heading}>
            {copy.title}
          </h1>
          <p className="mt-3 text-lg leading-relaxed opacity-80 sm:text-xl">{copy.subhead}</p>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" crossOrigin="anonymous" className="mt-6 aspect-[16/9] w-full rounded-2xl object-cover" />
          )}
          <p className="mt-6 text-[17px] leading-relaxed">{copy.intro}</p>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {copy.why.map((w) => (
              <li key={w} className="flex items-start gap-2 text-[15px]">
                <Check className="mt-0.5 size-5 shrink-0" style={{ color: "var(--lp-accent)" }} />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside id="book" className="min-w-0 scroll-mt-4 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-lg font-bold sm:text-xl" style={heading}>{copy.cta}</h2>
            <p className="mb-4 mt-0.5 text-sm text-slate-500">Pick a time. It takes under a minute.</p>
            {call && <CallNow phone={call.phone} display={displayPhone(call.phone)} firstName={call.firstName} preview={preview} />}
            <BookingWidget
              slug={agent.slug}
              firstName={agent.full_name}
              preview={preview}
              questions={preBookingQuestions(withRuleQuestions(questions, rulesOf(agent)), requiredSteps)}
              requiredSteps={requiredSteps}
              meeting="roof inspection"
            />
          </div>
        </aside>

        <section className="min-w-0 space-y-10 lg:col-start-1">
          <div>
            <h2 className="text-xl font-bold" style={heading}>How it works</h2>
            <ol className="mt-4 space-y-4">
              {copy.steps.map((s, i) => (
                <li key={s.title} className="flex gap-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--lp-accent)", color: "var(--lp-on-accent)" }}>
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-semibold">{s.title}</div>
                    <div className="opacity-80">{s.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {!!testimonials?.length && (
            <div>
              <h2 className="text-xl font-bold" style={heading}>What homeowners say</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {testimonials.map((t) => (
                  <figure key={t.id} className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200">
                    {t.rating && <Stars value={Number(t.rating)} className="mb-2" />}
                    <blockquote className="text-[15px] leading-relaxed">“{t.quote}”</blockquote>
                    <figcaption className="mt-3 text-sm">
                      <span className="font-medium">{t.author_name}</span>
                      {t.author_detail && <span className="opacity-60"> · {t.author_detail}</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-xl font-bold" style={heading}>Questions</h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {copy.faq.map((f) => (
                <details key={f.q} className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                    {f.q}
                    <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 opacity-80">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <StickyBookBar preview={preview} call={call} label={copy.cta} />

      <footer className="mx-auto max-w-5xl px-4 pb-28 text-xs leading-relaxed text-slate-400 sm:px-6 lg:pb-10">
        <p>
          {copy.disclaimer}{" "}
          <Link href="/privacy" className="underline">
            Privacy policy
          </Link>
        </p>
      </footer>
    </div>
  );
}
