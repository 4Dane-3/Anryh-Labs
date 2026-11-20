import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronDown, Phone } from "lucide-react";
import { Stars } from "@/components/ui/stars";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAgentBySlug, type Agent } from "@/lib/booking/data";
import { QuoteForm } from "@/components/booking/QuoteForm";
import { GoogleBadge, GoogleG, OtherBadge, Placeholder, VideoTile } from "@/components/landing/ProofBits";
import { parseProof } from "@/lib/landing/proof";
import { voiceOnFor } from "@/lib/voice/dial";
import { StickyBookBar } from "@/components/booking/PageBits";
import { callButtonShows, displayPhone } from "@/lib/booking/call";
import { areaLabel, isRoofer } from "@/lib/verticals";
import { adGroupPlans } from "@/lib/google-ads/playbook";
import { planFacts } from "@/lib/google-ads/build";
import { groupByPath } from "@/lib/landing/groups";
import { landingCopy } from "@/lib/landing/copy";
import { brandTheme } from "@/lib/landing/theme";
import { researchLanding } from "@/lib/competitors/live";

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
  proof: unknown;
};

async function load(slug: string, path: string) {
  const group = groupByPath(path);
  const agent = await getAgentBySlug(slug);
  // Google ad groups follow the roofing playbook: clinics don't run Google Ads yet
  if (!group || !agent || !isRoofer(agent)) return null;
  const cols = "website, logo_path, heading_font, body_font, background, text_color, accent, deals, certifications, warranties, license";
  const brandQuery = (c: string) => supabaseAdmin.from("agent_brand").select(c).eq("agent_id", agent.id).maybeSingle();
  // Before migration 20261217000000 there is no proof column, and asking for it would lose their whole look
  let { data, error } = await brandQuery(`${cols}, proof`);
  if (error) ({ data, error } = await brandQuery(cols));
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
  // Competitor research's landing copy, when it was judged 9/10 better than every competitor page it was tested
  // against: its subhead, proof and sections take over; the headline stays the ad group's (what they searched)
  const research = await researchLanding(agent.id);
  if (!research) return { agent, brand, copy, special: facts.special, sections: [] as { title: string; body: string }[], researched: false };
  const why = [...new Set([...research.proof, ...copy.why])];
  return {
    agent,
    brand,
    copy: { ...copy, subhead: research.subhead ?? copy.subhead, why, cta: research.cta ?? copy.cta },
    special: facts.special ?? research.offer,
    sections: research.sections,
    researched: true,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, group } = await params;
  const page = await load(slug, group);
  if (!page) return {};
  return { title: `${page.copy.title} | ${page.agent.full_name}`, description: page.copy.subhead, robots: { index: false, follow: false } };
}

async function signed(path: string | null | undefined) {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from("creatives").createSignedUrl(path, 24 * 3600);
  return data?.signedUrl ?? null;
}

export default async function LandingPage({ params, searchParams }: Props) {
  const [{ slug, group }, query] = await Promise.all([params, searchParams]);
  const page = await load(slug, group);
  if (!page) notFound();
  const { agent, brand, copy: baseCopy, special, sections, researched } = page;
  const preview = query?.preview === "1";
  const emma = voiceOnFor(agent);
  const proof = parseProof(brand?.proof);

  // Without the voice agent nobody calls within seconds, so the page doesn't promise it
  const copy = emma
    ? baseCopy
    : {
        ...baseCopy,
        steps: baseCopy.steps.map((s, i) => (i === 1 ? { title: "We call you", body: "We call to ask a few quick questions about your roof, so your quote fits." } : s)),
        faq: baseCopy.faq.slice(1),
      };

  const [{ data: testimonials }, { data: hours }, { data: presenter }] = await Promise.all([
    supabaseAdmin.from("testimonials").select("id, author_name, author_detail, quote, rating").eq("agent_id", agent.id).eq("published", true).order("sort").limit(6),
    supabaseAdmin.from("availability_rules").select("weekday, start_time, end_time").eq("agent_id", agent.id),
    supabaseAdmin.from("agent_presenters").select("job_photo_paths").eq("agent_id", agent.id).maybeSingle(),
  ]);
  const [logo, photo, ownerVideo, ownerPoster, videos, logos] = await Promise.all([
    signed(brand?.logo_path ?? (agent as Agent & { ad_logo_path?: string | null }).ad_logo_path),
    signed((presenter as { job_photo_paths?: string[] } | null)?.job_photo_paths?.[0]),
    signed(proof.ownerVideo),
    signed(proof.ownerPoster),
    Promise.all(proof.videos.map(async (v) => ({ ...v, src: await signed(v.path), posterUrl: await signed(v.poster) }))),
    Promise.all(proof.logos.map(async (l) => ({ ...l, src: await signed(l.path) }))),
  ]);
  const call = callButtonShows(agent, hours ?? []) && agent.call_phone ? { phone: agent.call_phone, firstName: agent.full_name } : null;
  const hasStats = proof.stats.length > 0;
  const hasBadges = !!proof.rating || proof.badges.length > 0;
  const liveVideos = videos.filter((v) => v.src);
  const liveLogos = logos.filter((l) => l.src);
  const owner = proof.ownerName ?? "the owner";
  const warranty = brand?.warranties?.[0] ?? null;

  // Their look: colours and fonts read from their website (Start here → your brand)
  const theme = brandTheme(brand);
  const vars = theme.vars as React.CSSProperties;
  const fontHref = theme.fontHref;
  const heading = { fontFamily: theme.heading };
  const accentBtn = { background: "var(--lp-accent)", color: "var(--lp-on-accent)" };

  return (
    <div className="min-h-screen bg-white" style={{ ...vars, color: "var(--lp-ink)", fontFamily: theme.body }}>
      {fontHref && <link rel="stylesheet" href={fontHref} crossOrigin="anonymous" precedence="default" />}

      {/* Header and hero: one band in their colour, the quote form beside the promise */}
      <div style={{ background: "var(--lp-band)", color: "var(--lp-on-band)" }}>
        <header>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
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

        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 px-4 pb-12 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-x-14 lg:pb-16 lg:pt-10">
          <section className="min-w-0">
            {special && <p className="mb-3 inline-block rounded-full bg-black/85 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white">{special}</p>}
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" style={heading}>
              {copy.title}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed opacity-90 sm:text-xl">{copy.subhead}</p>
            <ul className="mt-6 space-y-2.5">
              {copy.why.slice(0, 3).map((w) => (
                <li key={w} className="flex items-center gap-2.5 text-[15px] font-medium sm:text-base">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/90 text-slate-900">
                    <Check className="size-4" />
                  </span>
                  {w}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href="#book" className="hidden h-12 items-center rounded-full bg-white px-7 text-base font-semibold text-slate-900 shadow-sm lg:inline-flex">
                {copy.cta}
              </a>
              {call && (
                <a href={`tel:${call.phone}`} className="inline-flex h-12 items-center gap-2 rounded-full bg-black/85 px-6 text-base font-semibold text-white">
                  <Phone className="size-4" /> {displayPhone(call.phone)}
                </a>
              )}
            </div>
            {proof.rating ? (
              <div className="mt-6"><GoogleBadge rating={proof.rating} reviews={proof.reviews} href={proof.reviewsUrl} onDark /></div>
            ) : (
              <Placeholder preview={preview} icon="badge" title="Google review score" hint="Your Google rating and review count with the Google logo, from your real profile." className="mt-6 max-w-md !bg-white/90" />
            )}
          </section>

          <aside id="book" className="min-w-0 scroll-mt-4 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-3xl bg-white p-5 text-slate-900 shadow-xl ring-1 ring-black/5 sm:p-7">
              <QuoteForm
                slug={agent.slug}
                firstName={agent.full_name}
                preview={preview}
                roof
                inline
                heading={copy.cta.replace("Get my", "Get your")}
                subheading={emma ? "Emma, our AI assistant, calls you right away with a few quick questions about your roof." : "We call you to ask a few quick questions about your roof."}
                cta={emma ? "Yes, send my quote request" : "Send my quote request"}
              />
            </div>
          </aside>
        </div>
      </div>

      <main className="mx-auto max-w-6xl space-y-14 px-4 pb-28 pt-12 sm:px-6 lg:pb-16">
        {/* Numbers */}
        {hasStats ? (
          <section className={`grid gap-3 sm:grid-cols-2 ${proof.stats.length > 2 ? "lg:grid-cols-4" : ""}`}>
            {proof.stats.map((x) => (
              <div key={x.label} className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
                <div className="text-3xl font-extrabold" style={{ ...heading, color: "var(--lp-accent)" }}>{x.value}</div>
                <div className="mt-1 text-sm opacity-80">{x.label}</div>
              </div>
            ))}
          </section>
        ) : (
          <Placeholder preview={preview} icon="badge" title="Four numbers that prove it" hint="Real figures only: for example jobs completed, years in business, average response time, warranty length." />
        )}

        {/* Review badges and customers */}
        {(hasBadges || liveLogos.length > 0 || preview) && (
          <section className="space-y-5">
            {proof.badges.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {proof.rating && <GoogleBadge rating={proof.rating} reviews={proof.reviews} href={proof.reviewsUrl} />}
                {proof.badges.map((b) => <OtherBadge key={b.name} {...b} />)}
              </div>
            ) : (
              <Placeholder preview={preview} icon="badge" title="Other review badges" hint="HomeStars, Yelp, Facebook or BBB badge with its real score and count." />
            )}
            {liveLogos.length > 0 ? (
              <div>
                <p className="mb-3 text-sm font-semibold uppercase tracking-wider opacity-60">Trusted by</p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {liveLogos.map((l) => (
                    <div key={l.path} className="flex h-20 items-center justify-center rounded-xl bg-white p-3 ring-1 ring-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.src!} alt={l.name} crossOrigin="anonymous" className="max-h-full max-w-full object-contain" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={preview ? "grid grid-cols-3 gap-3 sm:grid-cols-6" : "hidden"}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Placeholder key={i} preview={preview} icon="image" title="Customer logo" hint="" className="!p-3 [&_p]:hidden" />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Owner video */}
        {(ownerVideo || preview) && (
          <section className="grid items-center gap-8 lg:grid-cols-2">
            {ownerVideo ? <VideoTile src={ownerVideo} poster={ownerPoster} /> : <Placeholder preview={preview} title="Owner video, 30 to 60 seconds" hint="The owner on camera: who answers the phone, how the quote works and what you promise, in their own words. A phone video is fine." className="aspect-video" />}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-60">Meet {owner}</p>
              <h2 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl" style={heading}>
                The person who answers is <span style={{ color: "var(--lp-accent)" }}>the one who shows up.</span>
              </h2>
              <ul className="mt-5 space-y-2.5">
                {copy.why.slice(3).map((w) => (
                  <li key={w} className="flex items-center gap-2.5">
                    <Check className="size-5 shrink-0" style={{ color: "var(--lp-accent)" }} />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {photo && !ownerVideo && !preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" crossOrigin="anonymous" className="aspect-[16/7] w-full rounded-3xl object-cover" />
        )}

        {/* Competitor research's sections: written to answer what the competitors' pages leave out */}
        {sections.length > 0 && (
          <section data-research="landing">
            <h2 className="text-2xl font-extrabold sm:text-3xl" style={heading}>Why homeowners pick {agent.full_name}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {sections.map((s) => (
                <div key={s.title} className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
                  <h3 className="font-bold" style={heading}>{s.title}</h3>
                  <p className="mt-1.5 leading-relaxed opacity-80">{s.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {preview && !researched && (
          <Placeholder preview={preview} icon="badge" title="Copy that beat the competitors' pages" hint="Appears once competitor research has written a landing page and the judge is 9/10 sure it beats every competitor page it was tested against." />
        )}

        {/* Guarantee: only what they actually offer */}
        {warranty && (
          <section className="rounded-3xl p-7 sm:p-10" style={accentBtn}>
            <h2 className="max-w-2xl text-2xl font-extrabold leading-tight sm:text-4xl" style={heading}>{warranty}</h2>
            <a href="#book" className="mt-5 inline-flex h-12 items-center rounded-full bg-white px-7 font-semibold text-slate-900">{copy.cta}</a>
          </section>
        )}

        {/* Customers on camera, then in writing */}
        {(proof.rating || liveVideos.length > 0 || !!testimonials?.length || preview) && (
        <section>
          <h2 className="text-2xl font-extrabold sm:text-3xl" style={heading}>What homeowners say</h2>
          {proof.rating && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-5xl font-extrabold" style={heading}>{proof.rating.toFixed(1)}</span>
              <GoogleBadge rating={proof.rating} reviews={proof.reviews} href={proof.reviewsUrl} />
            </div>
          )}
          {(liveVideos.length > 0 || preview) && (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => {
                const v = liveVideos[i];
                return v ? (
                  <VideoTile key={v.path} src={v.src!} poster={v.posterUrl} caption={`${v.name}${v.area ? `, ${v.area}` : ""}`} />
                ) : (
                  <Placeholder key={i} preview={preview} title={`Video testimonial ${i + 1}`} hint={i === 0 ? "A real customer on camera, 20 to 40 seconds, with their first name and neighbourhood. Poster frame, tap to play." : i === 1 ? "Best: a customer describing the leak or damage they called about, and what the price was." : "Three to start. Nine is where it stops helping."} className="aspect-video" />
                );
              })}
            </div>
          )}
          {!!testimonials?.length && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {testimonials.map((t) => (
                <figure key={t.id} className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
                  <div className="mb-2 flex items-center justify-between">
                    {t.rating ? <Stars value={Number(t.rating)} /> : <span />}
                    {proof.rating && <GoogleG className="size-4" />}
                  </div>
                  <blockquote className="text-[15px] leading-relaxed">“{t.quote}”</blockquote>
                  <figcaption className="mt-3 text-sm">
                    <span className="font-semibold">{t.author_name}</span>
                    {t.author_detail && <span className="opacity-60"> · {t.author_detail}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
        )}

        <section className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl" style={heading}>How it works</h2>
            <ol className="mt-5 space-y-5">
              {copy.steps.map((s, i) => (
                <li key={s.title} className="flex gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={accentBtn}>
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
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl" style={heading}>Questions</h2>
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
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

      <footer className="mx-auto max-w-6xl px-4 pb-28 text-xs leading-relaxed text-slate-400 sm:px-6 lg:pb-10">
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
