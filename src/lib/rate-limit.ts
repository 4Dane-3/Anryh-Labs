import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * The visitor's IP for rate limiting. On Vercel `x-real-ip` is set by the platform; the last
 * `x-forwarded-for` entry is the one our proxy appended, so a client can't choose it by sending its own header.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return forwarded[forwarded.length - 1] || "unknown";
}

/**
 * Counts one hit against `bucket` and returns false once it passes `max` within `windowSeconds`.
 * If the check itself fails (database trouble), the request is let through: a broken limiter shouldn't
 * stop real bookings, and the error is logged so it gets noticed.
 */
export async function allowWithin(bucket: string, windowSeconds: number, max: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) {
    console.error("rate limit check failed", bucket, error);
    return true;
  }
  return data !== false;
}

export function tooManyRequests(message = "Too many requests from here. Try again in a few minutes.") {
  return Response.json({ error: message }, { status: 429 });
}
