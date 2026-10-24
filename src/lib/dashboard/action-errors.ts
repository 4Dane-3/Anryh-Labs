// When a save fails because the request itself fails (the page is out of date after an update, the
// connection dropped, the session ended), React throws from the transition and the whole page is replaced
// by an error screen, losing everything typed. These helpers turn that into a message next to the form.

const STALE = /server action|was not found on the server|failed to find/i;
const OFFLINE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

/** What to tell someone whose save didn't go through. Plain words, and it says their text is kept. */
export function friendlyActionError(e: unknown): string {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (STALE.test(text)) return "Migz was updated while this page was open, so it couldn't save. Reload the page: what you typed is kept, then press Save again.";
  if (OFFLINE.test(text)) return "Couldn't reach Migz (check your connection). What you typed is kept: try again in a moment.";
  return "That didn't save. What you typed is kept: reload the page and press Save again.";
}

/** Runs a server action and returns its result, or {ok: false, error} instead of throwing if the request fails. */
export async function safely<T extends { ok: boolean }>(run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch (e) {
    console.error("server action failed", e instanceof Error ? e.message : e);
    return { ok: false, error: friendlyActionError(e) };
  }
}
