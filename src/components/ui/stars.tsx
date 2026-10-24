import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** A rating from 0.5 to 5 in half steps, rounded to the nearest half. Anything else is "no rating". */
export function halfStars(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5) return null;
  return Math.min(5, Math.round(value * 2) / 2);
}

/** "4.5" or "4": a rating as people write it. */
export const ratingText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * Five stars filled to a rating, with half stars: a half star is the filled star clipped to its left half
 * over an empty one. Colors are passed in so the same stars suit the light booking page and the dark dashboard.
 */
export function Stars({
  value,
  size = "size-4",
  filled = "fill-amber-400 text-amber-400",
  empty = "text-slate-300",
  className,
}: {
  value: number | null | undefined;
  size?: string;
  filled?: string;
  empty?: string;
  className?: string;
}) {
  const v = halfStars(value) ?? 0;
  return (
    <span className={cn("inline-flex gap-0.5", className)} role="img" aria-label={`${ratingText(v)} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const full = v >= i + 1;
        const half = !full && v >= i + 0.5;
        return (
          <span key={i} className={cn("relative inline-block", size)} aria-hidden="true">
            <Star className={cn("absolute inset-0 size-full", full ? filled : empty)} />
            {half && (
              <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                <Star className={cn("absolute left-0 top-0", size, filled)} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
