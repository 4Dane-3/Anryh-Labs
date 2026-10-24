"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Monitor, Pencil, Plus, RotateCw, Smartphone, Trash2, X } from "lucide-react";
import { ratingText, Stars } from "@/components/ui/stars";
import {
  createPhotoUpload,
  deleteTestimonial,
  saveTestimonial,
  setProfilePhoto,
  setPageFont,
  updateProfile,
} from "@/app/dashboard/actions";
import { PAGE_FONTS } from "@/lib/booking/page-fonts";
import { uploadToSignedUrl } from "@/lib/dashboard/upload";
import { safely } from "@/lib/dashboard/action-errors";
import { clearDraft, readDraft, writeDraft } from "@/lib/dashboard/drafts";
import { initials } from "@/lib/dashboard/format";
import { Badge, Button, EmptyState, Label, Panel, PanelHeader, Switch, Tabs, inputClass } from "@/components/dashboard/ui";
import { DEFAULT_TITLE } from "@/lib/campaign";
import { cn } from "@/lib/utils";

export type Profile = {
  full_name: string;
  title: string;
  headline: string;
  bio: string;
  license_number: string;
  licensed_states: string[];
  photo_url: string | null;
};

type Testimonial = {
  id: string;
  author_name: string;
  author_detail: string | null;
  quote: string;
  rating: number | null;
  published: boolean;
};

const STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );

function SavedNote({ show, children = "Saved" }: { show: boolean; children?: React.ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          className="text-[13px] text-good"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ---------- Profile ----------

export function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(profile);
  const [photo, setPhoto] = useState(profile.photo_url);
  const [photoProgress, setPhotoProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await updateProfile(form);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
      onSaved();
    });

  async function uploadPhoto(file: File) {
    setError(null);
    const start = await createPhotoUpload({ name: file.name, type: file.type, size: file.size });
    if (!start.ok) return setError(start.error);
    try {
      setPhotoProgress(0);
      await uploadToSignedUrl(start.signedUrl, file, setPhotoProgress);
      const res = await setProfilePhoto(start.path);
      if (!res.ok) throw new Error(res.error);
      setPhoto(URL.createObjectURL(file));
      router.refresh();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPhotoProgress(null);
    }
  }

  const removePhoto = () =>
    startTransition(async () => {
      const res = await setProfilePhoto(null);
      if (!res.ok) return setError(res.error);
      setPhoto(null);
      router.refresh();
      onSaved();
    });

  return (
    <Panel>
      <div className="space-y-5 px-5 py-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative size-16 shrink-0 overflow-hidden rounded-full bg-ink-high"
            aria-label="Change photo"
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" crossOrigin="anonymous" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-lg font-semibold text-fg-muted">
                {initials(form.full_name || "?")}
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5 text-white" />
            </span>
            {photoProgress !== null && (
              <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                <span className="block h-full bg-brand transition-[width]" style={{ width: `${photoProgress * 100}%` }} />
              </span>
            )}
          </button>
          <div>
            <p className="text-sm font-medium">Profile photo</p>
            <p className="text-[13px] text-fg-muted">A friendly, well-lit headshot works best.</p>
            <div className="mt-1.5 flex gap-1">
              <Button size="sm" variant="ghost" className="-ml-3" onClick={() => fileRef.current?.click()}>
                {photo ? "Replace" : "Upload"}
              </Button>
              {photo && (
                <Button size="sm" variant="ghost" onClick={removePhoto}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadPhoto(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="full_name">Your name</Label>
            <input id="full_name" className={inputClass} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="license">License number</Label>
            <input
              id="license"
              className={inputClass}
              placeholder="Shown in your page footer"
              value={form.license_number}
              onChange={(e) => set("license_number", e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="title">Your title</Label>
          <input
            id="title"
            className={inputClass}
            maxLength={80}
            placeholder={DEFAULT_TITLE}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
          <p className="mt-1 text-[12px] text-fg-faint">Shown under your name on your page. Leave it blank to use &ldquo;{DEFAULT_TITLE}&rdquo;.</p>
        </div>

        <div>
          <Label htmlFor="headline">Headline</Label>
          <input
            id="headline"
            className={inputClass}
            maxLength={140}
            placeholder="Life insurance that fits your family and your budget"
            value={form.headline}
            onChange={(e) => set("headline", e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="bio">About you</Label>
            <span className="text-[11px] text-fg-faint">{form.bio.length}/1200</span>
          </div>
          <textarea
            id="bio"
            rows={5}
            maxLength={1200}
            className={inputClass}
            placeholder="Who you help, how you work, and why people like working with you."
            value={form.bio}
            onChange={(e) => set("bio", e.target.value)}
          />
        </div>

        <div>
          <Label>Licensed in</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence initial={false}>
              {form.licensed_states.map((s) => (
                <motion.span
                  key={s}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="inline-flex items-center gap-1 rounded-md bg-white/[0.07] py-1 pl-2 pr-1 text-[13px]"
                >
                  {s}
                  <button
                    type="button"
                    aria-label={`Remove ${s}`}
                    onClick={() => set("licensed_states", form.licensed_states.filter((x) => x !== s))}
                    className="rounded p-0.5 text-fg-faint hover:text-fg"
                  >
                    <X className="size-3" />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            <select
              aria-label="Add a state"
              className="rounded-md border border-dashed border-line-strong bg-transparent px-2 py-1 text-[13px] text-fg-muted focus:outline-none"
              value=""
              onChange={(e) => e.target.value && set("licensed_states", [...form.licensed_states, e.target.value].sort())}
            >
              <option value="">+ Add state</option>
              {STATES.filter((s) => !form.licensed_states.includes(s)).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-[13px] text-bad">{error}</p>}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <SavedNote show={saved}>Saved. The preview is updated.</SavedNote>
      </div>
    </Panel>
  );
}

// ---------- Testimonials ----------

const emptyDraft = {
  author_name: "",
  author_detail: "",
  quote: "",
  rating: 5 as number | null,
  published: true,
  permission_confirmed: false,
};

function TestimonialForm({
  initial,
  onDone,
}: {
  initial?: Testimonial;
  onDone: () => void;
}) {
  const router = useRouter();
  const draftKey = `testimonial:${initial?.id ?? "new"}`;
  const [draft, setDraft] = useState(
    () =>
      readDraft<typeof emptyDraft>(draftKey) ??
      (initial ? { ...initial, author_detail: initial.author_detail ?? "", permission_confirmed: true } : emptyDraft),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Keep what's typed in this browser until it's saved, so a reload or a failed save never loses it
  useEffect(() => {
    writeDraft(draftKey, draft);
  }, [draftKey, draft]);

  const discard = () => {
    clearDraft(draftKey);
    onDone();
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      // A failed request (page out of date, connection) comes back as a message, not a crash
      const res = await safely(() => saveTestimonial({ ...draft, id: initial?.id }));
      if (!res.ok) return setError(res.error);
      clearDraft(draftKey);
      router.refresh();
      onDone();
    });

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="space-y-4 border-b border-line bg-white/[0.02] px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="t-name">Client name</Label>
            <input
              id="t-name"
              className={inputClass}
              placeholder="Maria G."
              value={draft.author_name}
              onChange={(e) => setDraft({ ...draft, author_name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="t-detail">Detail (optional)</Label>
            <input
              id="t-detail"
              className={inputClass}
              placeholder="Mother of two · Austin, TX"
              value={draft.author_detail}
              onChange={(e) => setDraft({ ...draft, author_detail: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="t-quote">What they said</Label>
          <textarea
            id="t-quote"
            rows={3}
            maxLength={600}
            className={inputClass}
            value={draft.quote}
            onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <StarPicker value={draft.rating} onChange={(rating) => setDraft({ ...draft, rating })} />
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            <Switch label="Show on my page" checked={draft.published} onChange={(v) => setDraft({ ...draft, published: v })} />
            Show on my page
          </label>
        </div>
        <label className="flex items-start gap-2.5 text-[13px] text-fg-muted">
          <input
            type="checkbox"
            checked={draft.permission_confirmed}
            onChange={(e) => setDraft({ ...draft, permission_confirmed: e.target.checked })}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          These are a real client&apos;s own words, and they gave me permission to share them.
        </label>
        {error && <p className="text-[13px] text-bad">{error}</p>}
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={save} disabled={pending}>
            {initial ? "Save" : "Add testimonial"}
          </Button>
          <Button variant="ghost" size="sm" onClick={discard}>
            Cancel
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function TestimonialsList({ testimonials, onChanged }: { testimonials: Testimonial[]; onChanged: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // After a reload, bring back a new testimonial that was being typed but wasn't saved
  useEffect(() => {
    // Browser storage only exists on the client, so this can't be known while rendering on the server
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (readDraft("testimonial:new")) setEditing("new");
  }, []);

  const togglePublished = (t: Testimonial) =>
    startTransition(async () => {
      setListError(null);
      const res = await safely(() => saveTestimonial({ ...t, author_detail: t.author_detail ?? "", published: !t.published, permission_confirmed: true }));
      if (!res.ok) return setListError(res.error);
      router.refresh();
      onChanged();
    });

  const remove = (id: string) =>
    startTransition(async () => {
      setListError(null);
      const res = await safely(() => deleteTestimonial(id));
      if (!res.ok) return setListError(res.error);
      router.refresh();
      onChanged();
    });

  const done = () => {
    setEditing(null);
    onChanged();
  };

  return (
    <Panel>
      <PanelHeader
        title="Testimonials"
        description="Real words from clients, shown under your intro."
        action={
          editing !== "new" && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> Add
            </Button>
          )
        }
      />
      {listError && <p className="border-b border-line px-5 py-3 text-[13px] text-bad">{listError}</p>}
      <AnimatePresence initial={false}>{editing === "new" && <TestimonialForm key="new" onDone={done} />}</AnimatePresence>

      {testimonials.length ? (
        <ul className="divide-y divide-line">
          {testimonials.map((t) => (
            <li key={t.id}>
              <AnimatePresence initial={false} mode="wait">
                {editing === t.id ? (
                  <TestimonialForm key="edit" initial={t} onDone={done} />
                ) : (
                  <motion.div
                    key="view"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={cn("flex gap-4 px-5 py-4", !t.published && "opacity-60")}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-relaxed text-fg">“{t.quote}”</p>
                      <p className="mt-1.5 text-[12px] text-fg-muted">
                        {t.author_name}
                        {t.author_detail && <span className="text-fg-faint"> · {t.author_detail}</span>}
                        {t.rating && <span className="text-fg-faint"> · {ratingText(Number(t.rating))}★</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      {!t.published && <Badge className="mr-1 mt-1">Hidden</Badge>}
                      <Switch label="Show on my page" checked={t.published} onChange={() => togglePublished(t)} />
                      <button
                        onClick={() => setEditing(t.id)}
                        aria-label="Edit testimonial"
                        className="ml-1 rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => remove(t.id)}
                        aria-label="Delete testimonial"
                        className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.06] hover:text-bad"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          ))}
        </ul>
      ) : (
        editing !== "new" && (
          <EmptyState title="No testimonials yet" action={<Button size="sm" onClick={() => setEditing("new")}>Add your first</Button>}>
            A couple of short quotes from happy clients make people far more likely to book.
          </EmptyState>
        )
      )}
    </Panel>
  );
}

// ---------- Preview ----------

function PagePreview({ slug, version }: { slug: string; version: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [boxWidth, setBoxWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [manual, setManual] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = device === "phone" ? { w: 390, h: 780 } : { w: 1280, h: 860 };
  const scale = boxWidth ? Math.min(1, boxWidth / frame.w) : 0;
  const key = `${version}-${manual}-${device}`;

  return (
    <Panel className="xl:sticky xl:top-8">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {(["phone", "desktop"] as const).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDevice(d);
                setLoaded(false);
              }}
              aria-label={`${d} preview`}
              className={cn(
                "relative rounded-md px-2.5 py-1 text-fg-muted transition-colors",
                device === d && "text-fg",
              )}
            >
              {device === d && (
                <motion.span layoutId="preview-device" className="absolute inset-0 rounded-md bg-white/[0.08]" />
              )}
              {d === "phone" ? <Smartphone className="relative size-4" /> : <Monitor className="relative size-4" />}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-fg-faint">Booking is off in the preview</span>
        <button
          onClick={() => {
            setManual((m) => m + 1);
            setLoaded(false);
          }}
          aria-label="Reload preview"
          className="rounded-md p-1.5 text-fg-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          <RotateCw className="size-4" />
        </button>
      </div>
      <div ref={boxRef} className="flex justify-center overflow-hidden bg-ink p-4">
        {scale > 0 && (
          <motion.div
            layout
            className="relative overflow-hidden rounded-[18px] border border-line-strong bg-white shadow-2xl"
            style={{ width: frame.w * scale - (device === "phone" ? 0 : 0), height: frame.h * scale }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
          >
            <iframe
              key={key}
              title="Your page"
              src={`/${slug}?preview=1`}
              onLoad={() => setLoaded(true)}
              className="origin-top-left border-0"
              style={{ width: frame.w, height: frame.h, transform: `scale(${scale})` }}
            />
            <AnimatePresence>
              {!loaded && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 animate-pulse bg-slate-100"
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </Panel>
  );
}

// ---------- Star rating ----------

/** Pick a rating in half steps: tap the left half of a star for x.5, the right half for the whole star. */
function StarPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const pick = (v: number) => onChange(value === v ? null : v);
  return (
    <div className="flex items-center gap-2">
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <Stars value={shown} size="size-6" filled="fill-brand text-brand" empty="text-fg-faint" className="gap-1" />
        {/* Ten invisible half-width buttons over the stars: 0.5, 1, 1.5 ... 5 */}
        <div role="radiogroup" aria-label="Star rating" className="absolute inset-0 flex">
          {Array.from({ length: 10 }, (_, k) => {
            const v = (k + 1) / 2;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={value === v}
                aria-label={`${v} star${v === 1 ? "" : "s"}`}
                onClick={() => pick(v)}
                onMouseEnter={() => setHover(v)}
                onFocus={() => setHover(v)}
                onBlur={() => setHover(null)}
                className="h-full flex-1 cursor-pointer"
              />
            );
          })}
        </div>
      </div>
      <span className="min-w-[4.5rem] text-[12px] text-fg-muted">{shown ? `${ratingText(shown)} of 5` : "No rating"}</span>
    </div>
  );
}

// ---------- Font ----------

/** The booking page's font: each option shown in itself. Saves on tap; the preview reloads. */
function FontPicker({ current, firstName, onSaved }: { current: string; firstName: string; onSaved: () => void }) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const choose = (key: string) =>
    start(async () => {
      const previous = value;
      setValue(key);
      setError(null);
      const res = await setPageFont(key);
      if (!res.ok) {
        setValue(previous);
        setError(res.error);
      } else onSaved();
    });
  return (
    <Panel className="mt-6">
      <PanelHeader title="Page font" description="The font people see on your booking page. Arial is the most familiar; Nunito is the friendliest." />
      <div role="radiogroup" aria-label="Page font" className="grid gap-2 p-5 sm:grid-cols-2">
        {PAGE_FONTS.map((f) => {
          const on = value === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              onClick={() => choose(f.key)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${on ? "border-brand/60 bg-brand/[0.07]" : "border-line hover:border-line-strong"}`}
            >
              <span className={`block text-[17px] font-bold text-fg ${f.className}`} style={f.style}>
                Book a free call with {firstName}
              </span>
              <span className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-fg">{f.label}{f.key === "arial" && <span className="font-normal text-fg-faint"> · default</span>}</span>
                <span className="text-[12px] text-fg-muted">{f.note}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="px-5 pb-4 text-[13px] text-bad">{error}</p>}
    </Panel>
  );
}

// ---------- Page ----------

export function LandingEditor({
  tab,
  slug,
  profile,
  testimonials,
  pageFontKey = "arial",
}: {
  tab: "profile" | "testimonials";
  slug: string;
  profile: Profile;
  testimonials: Testimonial[];
  pageFontKey?: string;
}) {
  // Bumped after every save so the preview iframe reloads with the new content
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <div>
        <Tabs
          id="landing"
          active={tab}
          tabs={[
            { key: "profile", label: "Profile", href: "/dashboard/landing" },
            { key: "testimonials", label: `Testimonials${testimonials.length ? ` · ${testimonials.length}` : ""}`, href: "/dashboard/landing?tab=testimonials" },
          ]}
        />
        {tab === "profile" ? (
          <>
            <ProfileForm profile={profile} onSaved={bump} />
            <FontPicker current={pageFontKey} firstName={profile.full_name.split(" ")[0] || "me"} onSaved={bump} />
          </>
        ) : (
          <TestimonialsList testimonials={testimonials} onChanged={bump} />
        )}
      </div>
      <PagePreview slug={slug} version={version} />
    </div>
  );
}
