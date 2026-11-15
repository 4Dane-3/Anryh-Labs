import { Play, ImageIcon, Award } from "lucide-react";

// Small pieces of the landing page's proof sections.

/** Google's "G", in its four colours. */
export function GoogleG({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-label="Google" role="img">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.500 42.600 14.600 48 24 48z" />
    </svg>
  );
}

export function GoldStars({ value = 5, className = "size-4" }: { value?: number; className?: string }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className={className} fill={i < Math.round(value) ? "#f5b301" : "#d4d4d8"} aria-hidden="true">
          <path d="M10 1.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L1.400 7.800l6-.8L10 1.500z" />
        </svg>
      ))}
    </span>
  );
}

/** "4.9 · 212 Google reviews" pill with the Google logo. */
export function GoogleBadge({ rating, reviews, href, onDark = false }: { rating: number; reviews: number | null; href: string | null; onDark?: boolean }) {
  const inner = (
    <>
      <GoogleG />
      <GoldStars value={rating} />
      <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
      {reviews && <span className="text-sm opacity-70">· {reviews.toLocaleString()} Google reviews</span>}
    </>
  );
  const cls = `inline-flex flex-wrap items-center gap-2 rounded-full px-4 py-2 ring-1 ${onDark ? "bg-white text-slate-900 ring-white/40" : "bg-white text-slate-900 ring-slate-200"}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export function OtherBadge({ name, rating, count }: { name: string; rating: number | null; count: number | null }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-slate-900 ring-1 ring-slate-200">
      <Award className="size-4" style={{ color: "var(--lp-accent)" }} />
      <span className="text-sm font-semibold">{name}</span>
      {rating && <GoldStars value={rating} className="size-3.5" />}
      {rating && <span className="text-sm font-semibold">{rating.toFixed(1)}</span>}
      {count && <span className="text-sm opacity-70">· {count.toLocaleString()}</span>}
    </span>
  );
}

/**
 * A dashed "add this" box. Rendered only in preview (staff, the dashboard's preview links), so visitors never see
 * an empty slot.
 */
export function Placeholder({ preview, icon = "video", title, hint, className = "" }: { preview: boolean; icon?: "video" | "image" | "badge"; title: string; hint: string; className?: string }) {
  if (!preview) return null;
  const Icon = icon === "video" ? Play : icon === "image" ? ImageIcon : Award;
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center ${className}`}>
      <Icon className="size-6 text-slate-500" />
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="max-w-xs text-xs leading-relaxed text-slate-500">{hint}</p>
      <p className="text-xs italic text-slate-400">Visitors see nothing here until it is added.</p>
    </div>
  );
}

/** A tap-to-play video: poster first, never autoplays, loads nothing until played. */
export function VideoTile({ src, poster, caption, className = "" }: { src: string; poster: string | null; caption?: string; className?: string }) {
  return (
    <figure className={className}>
      <video controls playsInline preload="none" poster={poster ?? undefined} crossOrigin="anonymous" className="aspect-video w-full rounded-2xl bg-slate-900 object-cover">
        <source src={src} />
      </video>
      {caption && <figcaption className="mt-2 text-sm font-medium">{caption}</figcaption>}
    </figure>
  );
}
