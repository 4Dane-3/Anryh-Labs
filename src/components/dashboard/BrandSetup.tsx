"use client";

import { useState, useTransition } from "react";
import { createCreativeUpload } from "@/app/dashboard/actions";
import { addBrandLogo, saveBrand, scanWebsite, type BrandInput } from "@/app/dashboard/creatives/actions";
import { Panel } from "@/components/dashboard/ui";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";
import { CERTIFICATIONS, SPECIALS, WARRANTIES } from "@/lib/roofing/setup-options";

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

function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border px-3 py-1 text-[12px] ${on ? "border-brand bg-brand/10 text-fg" : "border-line text-fg-muted hover:text-fg"}`}>
      {children}
    </button>
  );
}

/** Adds a line to a one-per-line list, or takes it out. */
const toggleLine = (text: string, line: string) => {
  const list = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (list.includes(line) ? list.filter((l) => l !== line) : [...list, line]).join("\n");
};

/**
 * Their brand for every edited video: the website scan, logo, and the special and credentials videos may feature.
 * In setup (`details`), the business details come first and the look (website, fonts, colours) after.
 */
export function BrandSetup({ initial, details, onSaved }: { initial: BrandInitial; details?: boolean; onSaved?: () => void }) {
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
      setNotice(r.ok ? { ok: true, text: "Saved. Your next videos use these details." } : { ok: false, text: r.error ?? "Couldn't save." });
      if (r.ok) onSaved?.();
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

  const detailFields = (
    <>
      <div className="text-sm text-fg">
        Your special for this campaign
        <p className="text-[12px] text-fg-muted">What your ads feature, exactly as you offer it. Migz checks with you every week that it&apos;s still running.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SPECIALS.map((d) => (
            <Pick key={d} on={deals.split("\n").map((l) => l.trim()).includes(d)} onClick={() => setDeals(toggleLine(deals, d))}>
              {d}
            </Pick>
          ))}
        </div>
        <textarea value={deals} onChange={(e) => setDeals(e.target.value)} rows={2} placeholder="Or type your own, one per line (the first is featured)" className={field} />
      </div>
      <div className="text-sm text-fg">
        Certifications you actually hold
        <p className="text-[12px] text-fg-muted">Only pick ones you hold today. Skip this if you have none.</p>
        <div className="mt-2 space-y-2">
          {CERTIFICATIONS.map((g) => (
            <div key={g.brand} className="flex flex-wrap items-center gap-2">
              <span className="w-28 shrink-0 text-[12px] text-fg-faint">{g.brand}</span>
              {g.tiers.map((c) => (
                <Pick key={c} on={v.certifications.includes(c)} onClick={() => toggleCert(c)}>
                  {c}
                </Pick>
              ))}
            </div>
          ))}
          {v.certifications.filter((c) => !CERTIFICATIONS.some((g) => g.tiers.includes(c))).map((c) => (
            <Pick key={c} on onClick={() => toggleCert(c)}>
              {c}
            </Pick>
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
      <div className="text-sm text-fg">
        Warranties, exactly as you offer them
        <div className="mt-2 flex flex-wrap gap-2">
          {WARRANTIES.map((w) => (
            <Pick key={w} on={warranties.split("\n").map((l) => l.trim()).includes(w)} onClick={() => setWarranties(toggleLine(warranties, w))}>
              {w}
            </Pick>
          ))}
        </div>
        <textarea value={warranties} onChange={(e) => setWarranties(e.target.value)} rows={2} placeholder="Or type your own, one per line" className={field} />
      </div>
      <label className="block text-sm text-fg">
        License number (optional)
        <input value={v.license} onChange={(e) => set({ license: e.target.value })} maxLength={40} placeholder="e.g. WA Lic #SUMMIPR123AB" className={field} />
      </label>
    </>
  );

  return (
    <Panel className={details ? "space-y-4 border-0 bg-transparent p-0 shadow-none" : "space-y-4 p-5"}>
      {!details && (
        <div>
          <p className="text-sm font-semibold text-fg">Your brand</p>
          <p className="text-[12px] text-fg-muted">Every video is edited in your fonts and colours, with only the special and credentials you list here.</p>
        </div>
      )}
{details && detailFields}
      {details && <p className="text-[12px] text-fg-muted pt-2 border-t border-line">Then your look, so every video is edited in your fonts and colours. Your website fills these in.</p>}
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

{!details && detailFields}
      <button type="button" onClick={save} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg disabled:opacity-50">
        {details ? "Save details" : "Save brand"}
      </button>
      {notice && (
        <p role="status" className={`text-sm ${notice.ok ? "text-fg-muted" : "text-red-400"}`}>
          {notice.text}
        </p>
      )}
    </Panel>
  );
}
