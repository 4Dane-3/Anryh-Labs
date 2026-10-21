import "server-only";

/** Scheduled endpoints are called by Supabase pg_cron with `Authorization: Bearer <CRON_SECRET>`. */
export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
