"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Play, Square, Star } from "lucide-react";
import { advanceResearch, cancelResearch, publishResearch, startResearch } from "@/app/admin/competitors/actions";
import { Badge, Button, EmptyState, Panel, PanelHeader, inputClass } from "@/components/dashboard/ui";
import { STAGES, type Run } from "@/lib/competitors/run-types";
import type { AdContext, CompAd, Headline, Market, ProofLine } from "@/lib/competitors/types";
import { cn } from "@/lib/utils";

type Roofer = { id: string; name: string; area: string };
type Ready = { apify: boolean; migration: boolean; google: boolean; googleLinked: boolean };
type View = "advertisers" | "ads" | "you" | "versus" | "published";
type ListMode = "all" | "top" | "offers";

const VIEWS: { id: View; label: string }[] = [
  { id: "advertisers", label: "Who advertises" },
  { id: "ads", label: "Ads" },
  { id: "you", label: "Your business" },
  { id: "versus", label: "Ours vs theirs" },
  { id: "published", label: "Published" },
];
const LIST_MODES: [ListMode, string][] = [
  ["all", "All"],
  ["top", "Top Rated"],
  ["offers", "Best Offers"],
];
const PLATFORM_LABEL = { google: "Google ads", meta: "Facebook & Instagram ads" } as const;
const HL_GROUPS: [Headline["stage"], string][] = [
  ["kept", "Passed all 3 filters (in the ad)"],
  ["spare", "Passed all 3, not in the best 15"],
  ["rules", "Failed filter 1: the rules"],
  ["buyer", "Failed filter 2: the harsh buyer"],
  ["repeat", "Failed filter 3: variety"],
];

const fmt = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US"));

export function CompetitorsView({ roofers, agentId, initialRun, context, ready }: { roofers: Roofer[]; agentId: string | null; initialRun: Run | null; context: AdContext | null; ready: Ready }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(initialRun);
  const [view, setView] = useState<View>("ads");
  const [budget, setBudget] = useState("10");
  const [benchmark, setBenchmark] = useState("Dublin, Ireland");
  const [small, setSmall] = useState(true);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);
  const running = run?.status === "running";

  // While a run is going, keep moving it along (each call does one or more steps, then returns)
  useEffect(() => {
    if (!running || !run) return;
    let live = true;
    const tick = async () => {
      const r = await advanceResearch(run.id).catch(() => null);
      if (!live || !r) return;
      if (r.ok) {
        setRun(r.run);
        if (r.run.status !== "running") router.refresh();
      }
    };
    const t = setInterval(tick, 12_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [running, run, router]);

  const begin = () =>
    start(async () => {
      setNote(null);
      if (!agentId) return;
      const r = await startResearch({ agentId, budgetUsd: Number(budget), benchmark, small });
      if (!r.ok) return setNote({ good: false, text: r.error });
      router.refresh();
      const a = await advanceResearch(r.id);
      if (a.ok) setRun(a.run);
    });

  const roofer = roofers.find((r) => r.id === agentId);

  return (
    <div className="space-y-6">
      {!ready.migration && <Notice tone="bad">Run migration 20261215000000_competitor_research.sql first.</Notice>}
      {!ready.apify && <Notice tone="bad">Add APIFY_API to the environment (Vercel and .env.local). Migz uses Apify for Google Maps, the Ads Transparency Center, Meta&apos;s Ad Library and Google reviews.</Notice>}

      <Panel>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-[12px] text-fg-muted">Roofing company</label>
            <select className={cn(inputClass, "[&>option]:bg-[#26282a]")} value={agentId ?? ""} onChange={(e) => router.push(`/admin/competitors?agent=${e.target.value}`)}>
              {roofers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.area}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-fg-muted">Benchmark market (EU reach data)</label>
            <input className={cn(inputClass, "w-48")} value={benchmark} onChange={(e) => setBenchmark(e.target.value)} disabled={running} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-fg-muted">Apify budget</label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-fg-muted">$</span>
              <input className={cn(inputClass, "w-20")} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} disabled={running} />
            </div>
          </div>
          <label className="flex items-center gap-2 pb-2 text-[13px] text-fg">
            <input type="checkbox" checked={small} onChange={(e) => setSmall(e.target.checked)} disabled={running} className="accent-[var(--color-brand)]" />
            Small test
          </label>
          {running ? (
            <Button variant="ghost" disabled={pending} onClick={() => start(async () => void (await cancelResearch(run!.id), setRun({ ...run!, status: "canceled" })))}>
              <Square /> Stop
            </Button>
          ) : (
            <Button variant="primary" disabled={pending || !agentId || !ready.apify || !ready.migration} onClick={begin}>
              {pending ? <Loader2 className="animate-spin" /> : <Play />}
              {run ? "Run again" : "Run research"}
            </Button>
          )}
        </div>
        <p className="border-t border-line px-5 py-3 text-[12px] text-fg-muted">
          {small ? "Small test: 5 roofers per market, 10 Facebook ads per Page, 30 headlines and 10 descriptions, 3 buyer rounds and no rewrites. Every step runs, for a fraction of the cost. " : ""}Looks at the top {small ? 5 : 50} roofers on Google Maps around {roofer?.area ?? "their service area"} and in {benchmark || "no benchmark"}, every ad they run, the page behind it, their Google reviews, then writes and tests ads that beat theirs. Takes 15 to 40 minutes. The Apify spend stops at the budget; model costs are counted in the roofer&apos;s Migz usage.
        </p>
        {note && <p className={cn("px-5 pb-3 text-[13px]", note.good ? "text-good" : "text-brand")}>{note.text}</p>}
      </Panel>

      {run && <Progress run={run} />}

      {run && (run.advertisers.length > 0 || context) && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)} className={cn("rounded-full border px-3.5 py-1.5 text-[13px] transition-colors", view === v.id ? "border-brand/60 bg-brand/[0.12] text-fg" : "border-line text-fg-muted hover:text-fg")}>
                {v.label}
              </button>
            ))}
          </div>
          {view === "advertisers" && <Advertisers run={run} />}
          {view === "ads" && <Ads run={run} />}
          {view === "you" && <YourBusiness context={context} />}
          {view === "versus" && <Versus run={run} />}
          {view === "published" && <PublishedView run={run} ready={ready} onPublished={() => router.refresh()} />}
        </>
      )}
      {!run && <Panel><EmptyState title="No research yet">Pick a roofer and press Run research. Migz will find who advertises against them and what&apos;s winning.</EmptyState></Panel>}
    </div>
  );
}

function Notice({ tone, children }: { tone: "bad" | "good"; children: React.ReactNode }) {
  return <p className={cn("rounded-lg border px-4 py-3 text-[13px]", tone === "bad" ? "border-brand/40 bg-brand/10 text-fg" : "border-good/30 bg-good/10 text-fg")}>{children}</p>;
}

function Progress({ run }: { run: Run }) {
  const at = STAGES.findIndex((s) => s.key === run.stage);
  return (
    <Panel>
      <PanelHeader
        title={run.status === "running" ? "Researching" : run.status === "done" ? "Research done" : run.status === "failed" ? "Research stopped" : "Research canceled"}
        description={`Started ${new Date(run.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · Apify $${Number(run.cost_usd).toFixed(2)} of $${Number(run.budget_usd).toFixed(0)}`}
        action={run.status === "running" ? <Loader2 className="size-4 animate-spin text-brand" /> : undefined}
      />
      <div className="grid gap-5 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ol className="space-y-1.5">
          {STAGES.filter((s) => s.key !== "done").map((s, i) => (
            <li key={s.key} className={cn("flex items-center gap-2 text-[13px]", i < at || run.status === "done" ? "text-fg" : i === at ? "text-brand" : "text-fg-faint")}>
              <span className={cn("size-1.5 rounded-full", i < at || run.status === "done" ? "bg-good" : i === at ? "bg-brand" : "bg-fg-faint")} />
              {s.label}
            </li>
          ))}
        </ol>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-[12px] text-fg-muted">
          {[...run.log].reverse().map((l, i) => (
            <li key={i}>
              <span className="font-mono text-fg-faint">{new Date(l.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span> {l.text}
            </li>
          ))}
        </ul>
      </div>
      {run.error && <p className="border-t border-line px-5 py-3 text-[13px] text-brand">{run.error}</p>}
    </Panel>
  );
}

function marketLabel(markets: Market[], key: string) {
  return markets.find((m) => m.key === key)?.label ?? key;
}

function Advertisers({ run }: { run: Run }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {run.markets.map((m) => {
        const list = run.advertisers.filter((a) => a.market === m.key).sort((a, b) => b.googleAds + b.metaAds - (a.googleAds + a.metaAds) || (b.reviews ?? 0) - (a.reviews ?? 0));
        return (
          <Panel key={m.key}>
            <PanelHeader title={`${m.label}${m.kind === "benchmark" ? " (benchmark)" : ""}`} description={`${list.length} roofers on Google Maps · ${list.filter((a) => a.googleAds).length} run Google ads · ${list.filter((a) => a.metaAds).length} run Facebook ads`} />
            <ul className="divide-y divide-line">
              {list.map((a) => (
                <li key={`${a.market}-${a.name}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <p className="truncate text-fg">{a.name}</p>
                    <p className="truncate text-[12px] text-fg-muted">
                      {a.domain ?? "no website"} · {a.rating ? `${a.rating}★ (${fmt(a.reviews)})` : "no rating"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone={a.googleAds ? "accent" : "neutral"}>Google {a.googleAds}</Badge>
                    <Badge tone={a.metaAds ? "accent" : "neutral"}>Meta {a.metaAds}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function Ads({ run }: { run: Run }) {
  const [mode, setMode] = useState<ListMode>("top");
  const [market, setMarket] = useState<string>("all");
  const [showOut, setShowOut] = useState(false);
  const ranked = run.stage !== "maps" && run.stage !== "homepages" && run.stage !== "ads" && run.stage !== "read";
  const inMarket = (a: CompAd) => market === "all" || a.market === market;
  const sections = (["google", "meta"] as const).map((p) => {
    let list = run.ads.filter((a) => a.platform === p && inMarket(a));
    const out = list.filter((a) => a.excluded);
    if (mode === "all") list = list.filter((a) => !a.excluded).sort((a, b) => (a.market === b.market ? (a.rank ?? 999) - (b.rank ?? 999) : a.market.localeCompare(b.market)));
    if (mode === "top") list = list.filter((a) => a.top).sort((a, b) => (a.market === b.market ? (a.rank ?? 999) - (b.rank ?? 999) : a.market.localeCompare(b.market)));
    if (mode === "offers") list = list.filter((a) => a.offerRank).sort((a, b) => a.offerRank! - b.offerRank!);
    return { p, list, out };
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {LIST_MODES.map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} disabled={!ranked && k !== "all"} className={cn("rounded-md px-3 py-1 text-[13px]", mode === k ? "bg-white/15 text-fg" : "text-fg-muted disabled:opacity-40")}>
              {l}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {[{ key: "all", label: "Both markets" }, ...run.markets].map((m) => (
            <button key={m.key} onClick={() => setMarket(m.key)} className={cn("rounded-md px-3 py-1 text-[13px]", market === m.key ? "bg-white/15 text-fg" : "text-fg-muted")}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-fg-muted">
          {mode === "top" ? "The best 15% of each list, ranked on its best clue." : mode === "offers" ? "Real offers only (a price, money off, something free, a guarantee, a speed promise), ranked like a harsh buyer." : "Every ad that ran 14+ days with a landing page, copies counted once."}
        </p>
      </div>
      {sections.map(({ p, list, out }) => (
        <Panel key={p}>
          <PanelHeader title={PLATFORM_LABEL[p]} description={`${list.length} shown${mode === "top" ? ` · ranked on ${run.markets.map((m) => `${m.label}: ${m.kind === "local" ? (p === "google" ? "days running" : "Meta's impressions order") : p === "google" ? "impressions a day" : "reach a day"}`).join(" · ")}` : ""}`} />
          {list.length ? (
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((a) => (
                <AdCard key={a.id} ad={a} market={marketLabel(run.markets, a.market)} mode={mode} />
              ))}
            </div>
          ) : (
            <EmptyState title={run.status === "running" && !ranked ? "Still pulling ads" : "None"} />
          )}
          {mode === "all" && out.length > 0 && (
            <div className="border-t border-line px-5 py-3">
              <button className="text-[12px] text-fg-muted hover:text-fg" onClick={() => setShowOut(!showOut)}>
                {showOut ? "Hide" : "Show"} the {out.length} left out
              </button>
              {showOut && (
                <ul className="mt-2 space-y-1 text-[12px] text-fg-muted">
                  {out.map((a) => (
                    <li key={a.id}>
                      <span className="text-fg">{a.advertiser}</span>: {a.headline ?? a.body?.slice(0, 60) ?? "(no text)"} · <span className="text-brand">{a.excluded}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

function Media({ ad }: { ad: CompAd }) {
  const [broken, setBroken] = useState(false);
  const src = ad.media.thumbnail ?? ad.media.image;
  if (!src || broken || (ad.platform === "google" && ad.format === "text" && ad.headline)) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="mb-3 aspect-video w-full rounded-md bg-white/5 object-cover" />;
}

function AdCard({ ad, market, mode }: { ad: CompAd; market: string; mode: ListMode }) {
  return (
    <article className="flex flex-col rounded-lg border border-line bg-white/[0.03] p-4">
      <Media ad={ad} />
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {mode === "offers" && ad.offerRank ? <Badge tone="good">Offer #{ad.offerRank}</Badge> : ad.rank ? <Badge tone={ad.top ? "accent" : "neutral"}>#{ad.rank}</Badge> : null}
        <Badge>{market}</Badge>
        {ad.daysRunning != null && <Badge>{ad.daysRunning} days</Badge>}
        {(ad.copies ?? 0) > 1 && <Badge>{ad.copies} copies</Badge>}
      </div>
      <p className="text-[12px] text-fg-muted">{ad.advertiser}</p>
      {ad.headline && <p className="mt-1 text-sm font-semibold text-fg">{ad.headline}</p>}
      {(ad.body || ad.description) && <p className="mt-1 line-clamp-5 whitespace-pre-line text-[13px] text-fg-muted">{ad.body ?? ad.description}</p>}
      {ad.offer && (
        <p className="mt-2 rounded-md bg-good/10 px-2 py-1 text-[12px] text-fg">
          <span className="font-semibold capitalize">{ad.offer.type}:</span> {ad.offer.text}
          {mode === "offers" && ad.offerWhy && <span className="block text-fg-muted">{ad.offerWhy}</span>}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3 text-[11px] text-fg-faint">
        <span>{ad.clue ?? ""}</span>
        <span className="flex gap-2">
          {ad.landingUrl && (
            <a href={ad.landingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
              Page <ExternalLink className="size-3" />
            </a>
          )}
          {ad.transparencyUrl && (
            <a href={ad.transparencyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
              Source <ExternalLink className="size-3" />
            </a>
          )}
        </span>
      </div>
    </article>
  );
}

function ProofList({ title, lines }: { title: string; lines: ProofLine[] }) {
  if (!lines.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold text-fg">{title}</p>
      <ul className="space-y-1 text-[13px]">
        {lines.map((l, i) => (
          <li key={i} className="text-fg">
            {l.adForm || l.claim} <span className="text-[11px] text-fg-faint">· {l.source}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function YourBusiness({ context }: { context: AdContext | null }) {
  if (!context) return <Panel><EmptyState title="Not read yet">Your business is read after the competitors: the website, Google reviews, testimonials and videos.</EmptyState></Panel>;
  const c = context;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <PanelHeader title={c.business.name} description={c.business.pitch} />
        <div className="space-y-4 px-5 py-4">
          <p className="text-[13px] text-fg-muted"><span className="text-fg">Buyer:</span> {c.business.buyer}</p>
          <ProofList title="Can claim: the offer" lines={c.proof.offer} />
          <ProofList title="Can claim: the promises" lines={c.proof.promises} />
          <ProofList title="Can claim: the numbers" lines={c.proof.numbers} />
          <div className="rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-[13px] text-fg"><span className="font-semibold">The gap:</span> {c.proof.gap}</div>
          <ProofList title="Hold (true, too weak to use)" lines={c.proof.hold} />
          {c.proof.never.length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-fg">Never say</p>
              <p className="text-[13px] text-fg-muted">{c.proof.never.join(" · ")}</p>
            </div>
          )}
          <p className="text-[11px] text-fg-faint">Read {new Date(c.builtAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} from {c.pagesRead.length} pages{c.business.site ? ` of ${c.business.site}` : ""}.</p>
        </div>
      </Panel>
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Google reviews" description={c.reviews.rating ? `${c.reviews.rating}★ from ${fmt(c.reviews.count)} reviews` : "No Google Business Profile found"} action={c.reviews.placeUrl ? <a href={c.reviews.placeUrl} target="_blank" rel="noreferrer" className="text-[12px] text-fg-muted hover:text-fg">Profile</a> : undefined} />
          <ul className="divide-y divide-line">
            {c.reviews.quotes.map((q, i) => (
              <li key={i} className="px-5 py-3 text-[13px]">
                <p className="text-fg">&ldquo;{q.text}&rdquo;</p>
                <p className="mt-1 flex items-center gap-1 text-[12px] text-fg-muted">
                  {q.author} {q.stars ? <><Star className="size-3 fill-current text-amber-400" /> {q.stars}</> : null} {q.date ? `· ${q.date}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Testimonials on their site" description={`${c.testimonials.length} found`} />
          <ul className="divide-y divide-line">
            {c.testimonials.map((t, i) => (
              <li key={i} className="px-5 py-3 text-[13px] text-fg">
                &ldquo;{t.text}&rdquo; <span className="text-[12px] text-fg-muted">{t.author ? `· ${t.author}` : ""}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Videos" description={`${c.videos.length} found`} />
          <ul className="divide-y divide-line">
            {c.videos.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                <span className="truncate text-fg">{v.title ?? v.url}</span>
                <span className="shrink-0 text-[12px] text-fg-muted">{v.source}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function GoogleAdPreview({ headlines, descriptions, label }: { headlines: string[]; descriptions: string[]; label: string }) {
  return (
    <div className="rounded-lg border border-line bg-white/[0.03] p-4">
      <p className="mb-1 text-[11px] uppercase tracking-wider text-fg-faint">{label}</p>
      <p className="text-[15px] font-semibold leading-snug text-[#8ab4f8]">{headlines.slice(0, 3).join(" | ")}</p>
      <p className="mt-1 text-[13px] text-fg-muted">{descriptions.slice(0, 2).join(" ")}</p>
    </div>
  );
}

function Versus({ run }: { run: Run }) {
  const d = run.drafts;
  if (!d) return <Panel><EmptyState title="No ads written yet">Ads are written once the competitors are ranked and your business is read.</EmptyState></Panel>;
  const funnel = [
    ["Written", d.counts.written || d.headlines.length],
    ["Passed the rules", d.counts.rules],
    ["Passed the harsh buyer", d.counts.buyer],
    ["Passed variety", d.counts.variety],
    ["In the ad", d.counts.kept],
  ] as const;
  return (
    <div className="space-y-6">
      <Notice tone={d.verdict.publishable ? "good" : "bad"}>
        <span className="font-semibold">{d.verdict.publishable ? `Publishable: ${d.verdict.minConfidence}/10 or better against every winner.` : "Not publishable yet."}</span> {d.verdict.why}
      </Notice>
      <Panel>
        <PanelHeader title="How many headlines passed each filter" />
        <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-5">
          {funnel.map(([label, n]) => (
            <div key={label}>
              <p className="text-[12px] text-fg-muted">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-fg">{n}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={`The ad: ${d.kept.headlines.length} headlines, ${d.kept.descriptions.length} descriptions`} />
          <div className="space-y-3 px-5 py-4">
            <GoogleAdPreview headlines={d.kept.headlines} descriptions={d.kept.descriptions} label="How it shows" />
            <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-fg">
              {d.kept.headlines.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
            <ul className="space-y-1 text-[13px] text-fg-muted">
              {d.kept.descriptions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </Panel>
        {d.landing && (
          <Panel>
            <PanelHeader title="The landing page" description={d.landing.versus.length ? `Least sure: ${Math.min(...d.landing.versus.map((v) => v.confidence))}/10 against their pages` : "No competitor pages to test against"} />
            <div className="space-y-3 px-5 py-4 text-[13px]">
              <p className="text-lg font-semibold text-fg">{d.landing.headline}</p>
              <p className="text-fg-muted">{d.landing.subhead}</p>
              <p className="rounded-md bg-good/10 px-2 py-1 text-fg">{d.landing.offer}</p>
              <ul className="list-disc pl-5 text-fg-muted">
                {d.landing.proof.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {d.landing.sections.map((s) => (
                <div key={s.title}>
                  <p className="font-semibold text-fg">{s.title}</p>
                  <p className="text-fg-muted">{s.body}</p>
                </div>
              ))}
              <p className="font-semibold text-brand">{d.landing.cta}</p>
              {d.landing.versus.map((v) => (
                <p key={v.url} className="text-[12px] text-fg-muted">
                  <Badge tone={v.confidence >= 9 ? "good" : "bad"}>{v.confidence}/10</Badge> vs {v.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)}: {v.why}
                </p>
              ))}
            </div>
          </Panel>
        )}
      </div>
      <Panel>
        <PanelHeader title="Ours vs the competitor ad it was tested against" description="Blind: the judge sees Ad A and Ad B in random order and never knows which is ours." />
        <div className="space-y-4 p-4">
          {d.matchups.map((m) => (
            <div key={m.theirs.id} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-start">
              <GoogleAdPreview headlines={m.ours.headlines} descriptions={m.ours.descriptions} label="Ours" />
              <div className="rounded-lg border border-line bg-white/[0.03] p-4">
                <p className="mb-1 text-[11px] uppercase tracking-wider text-fg-faint">{m.theirs.advertiser}</p>
                <p className="text-[15px] font-semibold text-fg">{m.theirs.headline}</p>
                <p className="mt-1 line-clamp-4 text-[13px] text-fg-muted">{m.theirs.text}</p>
              </div>
              <div className="md:w-56">
                <Badge tone={m.confidence >= 9 ? "good" : "bad"}>{m.confidence}/10 sure ours wins</Badge>
                <p className="mt-1 text-[12px] text-fg-muted">{m.why}</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <LineGroups title={`All ${d.headlines.length} headlines`} pool={d.headlines} />
      <LineGroups title={`All ${d.descriptions.length} descriptions`} pool={d.descriptions} />
    </div>
  );
}

function LineGroups({ title, pool }: { title: string; pool: Headline[] }) {
  const groups = useMemo(() => HL_GROUPS.map(([stage, label]) => ({ stage, label, lines: pool.filter((h) => h.stage === stage) })).filter((g) => g.lines.length), [pool]);
  return (
    <Panel>
      <PanelHeader title={title} />
      <div className="space-y-4 px-5 py-4">
        {groups.map((g) => (
          <details key={g.stage} open={g.stage === "kept"}>
            <summary className="cursor-pointer text-[13px] font-semibold text-fg">
              {g.label} <span className="font-mono text-fg-faint">{g.lines.length}</span>
            </summary>
            <ul className="mt-2 space-y-1">
              {g.lines.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                  <Badge tone={g.stage === "kept" ? "good" : g.stage === "spare" ? "accent" : "bad"}>{g.stage === "kept" || g.stage === "spare" ? "Passed" : "Failed"}</Badge>
                  <span className="text-fg">{h.text}</span>
                  <span className="text-[11px] text-fg-faint">{h.angle}{h.runs ? ` · picked ${h.wins}/${h.runs}` : ""}</span>
                  {h.reason && <span className="text-[12px] text-fg-muted">{h.reason}</span>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function PublishedView({ run, ready, onPublished }: { run: Run; ready: Ready; onPublished: () => void }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);
  const p = run.published;
  const can = !!run.drafts?.verdict.publishable && ready.google && ready.googleLinked;
  return (
    <Panel>
      <PanelHeader title="Google Ads" description="The ad goes in paused, never live: review it in Google Ads, then switch it on." />
      <div className="space-y-3 px-5 py-4 text-[13px]">
        {p ? (
          <p className="text-fg">
            {p.validateOnly ? "Checked with Google in validate-only mode (nothing created)" : "In Google Ads, paused"}: <span className="font-semibold">{p.campaignName}</span>
            {p.campaignId ? ` (campaign ${p.campaignId})` : ""}, {p.headlines} headlines and {p.descriptions} descriptions, {new Date(p.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
          </p>
        ) : (
          <p className="text-fg-muted">Not published.</p>
        )}
        {!run.drafts?.verdict.publishable && <p className="text-brand">Locked: {run.drafts?.verdict.why ?? "no ads yet."}</p>}
        {!ready.google && <p className="text-fg-muted">The Google Ads API isn&apos;t configured yet (GOOGLE_ADS_* keys).</p>}
        {ready.google && !ready.googleLinked && <p className="text-fg-muted">This roofer&apos;s Google Ads account isn&apos;t linked yet (their Start here → Google Ads step).</p>}
        {note && <p className={note.good ? "text-good" : "text-brand"}>{note.text}</p>}
        <Button
          variant="primary"
          disabled={!can || pending}
          onClick={() =>
            start(async () => {
              const r = await publishResearch(run.id);
              setNote(r.ok ? { good: true, text: r.message } : { good: false, text: r.error });
              if (r.ok) onPublished();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          {p ? "Add it again, paused" : "Add to Google Ads, paused"}
        </Button>
      </div>
    </Panel>
  );
}
