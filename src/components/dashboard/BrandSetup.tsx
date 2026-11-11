"use client";

import { useState, useTransition } from "react";
import { createCreativeUpload } from "@/app/dashboard/actions";
import { addBrandLogo, saveBrand, scanWebsite, type BrandInput } from "@/app/dashboard/creatives/actions";
import { Panel } from "@/components/dashboard/ui";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";
import { BADGE_SUGGESTIONS } from "@/lib/roofing/hooks";

export type BrandInitial = BrandInput & { hasLogo: boolean };

const field = "mt-1 w-full rounded-lg border border-line bg-ink-high px-3 py-2 text-sm text-fg";
const split = (s: string) => s.split("\n");

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-fg">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-10 rounded border border-line bg-transparent" />
        <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} className="w-24 rounded-lg border border-line bg-ink-high px-2 py-1.5 font-mono text-[13px] text-fg" />
      </span>
    </label>
  );
}

/** Their brand for every edited video: the website scan, logo, and the deals and credentials videos may feature. */
export function BrandSetup({ initial }: { initial: BrandInitial }) {
  const [v, setV] = useState(initial);
  const [deals, setDeals] = useState(initial.deals.join("\n"));
  const [warranties, setWarranties] = useState(initial.warranties.join("\n"));
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [logoProgress, setLogoProgress] = useState<number | null>(null);
  const [busy, start] = useTransition();
  const set = (patch: Partial<BrandInitial>) => setV((c) => ({ ...c, ...patch }));
  const toggleCert = (c: string) => set({ certifications: v.certifications.includes(c) ? v.certifications.filter((x) => x !== c) : [...v.certifications, c] });

  const scan = () =>
    start(async () => {
      const r = await scanWebsite(v.website);
      if (!r.ok || !r.found) return setNotice({ ok: false, text: r.error ?? "Couldn't read that website." });
      const f = r.found;
      set({ headingFont: f.headingFont, bodyFont: f.bodyFont, background: f.background, text: f.text, accent: f.accent, fontNote: f.note });
      setNotice({ ok: true, text: `Found ${f.headingFont} and ${f.bodyFont}. Check the colours, then save.${f.note ? ` ${f.note}` : ""}` });
    });
  const save = () =>
    start(async () => {
      const r = await saveBrand({ ...v, deals: split(deals), warranties: split(warranties) });
      setNotice(r.ok ? { ok: true, text: "Saved. Your next videos use this brand." } : { ok: false, text: r.error ?? "Couldn't save." });
    });
  const uploadLogo = async (file: File) => {
    try {
      setLogoProgress(0);
      const started = await createCreativeUpload({ name: file.name, type: file.type, size: file.size });
      if (!started.ok) throw new Error(started.error);
      await uploadToSignedUrl(started.signedUrl, file, setLogoProgress);
      const saved = await addBrandLogo(started.path);
      if (!saved.ok) throw new Error(saved.error);
      set({ hasLogo: true });
      setNotice({ ok: true, text: "Logo added." });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setLogoProgress(null);
    }
  };

  return (
    <Panel className="space-y-4 p-5">
      <div>
        <p className="text-sm font-semibold text-fg">Your brand</p>
        <p className="text-[12px] text-fg-muted">Every video is edited in your fonts and colours, with only the deals and credentials you list here.</p>
      </div>
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-sm text-fg">
          Your website
          <input value={v.website} onChange={(e) => set({ website: e.target.value })} placeholder="yourcompany.com" className={field} />
        </label>
        <button type="button" onClick={scan} disabled={busy || !v.website.trim()} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
          Get my brand
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-fg">
          Heading font
          <input value={v.headingFont} onChange={(e) => set({ headingFont: e.target.value })} className={field} />
        </label>
        <label className="block text-sm text-fg">
          Body font
          <input value={v.bodyFont} onChange={(e) => set({ bodyFont: e.target.value })} className={field} />
        </label>
      </div>
      <div className="flex flex-wrap gap-5">
        <Swatch label="Background" value={v.background} onChange={(background) => set({ background })} />
        <Swatch label="Text" value={v.text} onChange={(text) => set({ text })} />
        <Swatch label="Accent" value={v.accent} onChange={(accent) => set({ accent })} />
      </div>
      {/* What a caption and card will look like */}
      {[...new Set([v.headingFont, v.bodyFont].filter(Boolean))].map((f) => (
        <link key={f} rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;800&display=swap`} />
      ))}
      <div className="rounded-xl p-4" style={{ background: v.background, color: v.text }}>
        <p style={{ fontFamily: v.headingFont, fontWeight: 800, fontSize: 22 }}>
          Your roof, <span style={{ color: v.accent }}>inspected</span> free
        </p>
        <p style={{ fontFamily: v.bodyFont, fontSize: 13, opacity: 0.85 }}>How a caption and a card will look</p>
      </div>

      <label className="block text-sm text-fg">
        Logo (PNG with a transparent background works best){" "}
        <span className="text-fg-muted">{logoProgress !== null ? `${Math.round(logoProgress * 100)}%` : v.hasLogo ? "Added" : ""}</span>
        <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="mt-1 block text-sm text-fg-muted" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
      </label>

      <label className="block text-sm text-fg">
        Deals you&apos;re running, one per line (the first is featured)
        <textarea value={deals} onChange={(e) => setDeals(e.target.value)} rows={2} placeholder="$500 off a full replacement" className={field} />
      </label>
      <div className="text-sm text-fg">
        Certifications you actually hold
        <div className="mt-1 flex flex-wrap gap-2">
          {[...new Set([...BADGE_SUGGESTIONS, ...v.certifications])].map((c) => (
            <button key={c} type="button" onClick={() => toggleCert(c)} className={`rounded-full border px-3 py-1 text-[12px] ${v.certifications.includes(c) ? "border-brand text-fg" : "border-line text-fg-muted"}`}>
              {c}
            </button>
          ))}
        </div>
        <input
          placeholder="Another one? Type it and press Enter"
          className={field}
          onKeyDown={(e) => {
            const t = e.currentTarget.value.trim();
            if (e.key === "Enter" && t) {
              e.preventDefault();
              if (!v.certifications.includes(t)) set({ certifications: [...v.certifications, t] });
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
      <label className="block text-sm text-fg">
        License number (optional)
        <input value={v.license} onChange={(e) => set({ license: e.target.value })} maxLength={40} placeholder="e.g. WA Lic #SUMMIPR123AB" className={field} />
      </label>
      <label className="block text-sm text-fg">
        Warranties, one per line, exactly as you offer them
        <textarea value={warranties} onChange={(e) => setWarranties(e.target.value)} rows={2} placeholder="25-year workmanship warranty" className={field} />
      </label>
      <button type="button" onClick={save} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
        Save brand
      </button>
      {notice && (
        <p role="status" className={`text-sm ${notice.ok ? "text-fg-muted" : "text-red-400"}`}>
          {notice.text}
        </p>
      )}
    </Panel>
  );
}
