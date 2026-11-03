import "server-only";
import { graph, graphAll } from "@/lib/meta/graph";

// An agent shares their ad account and Facebook Page with Anryh Labs' Business Manager (a partner request in
// their Business Settings). Once staff accept it and assign both to the Migz system user, the system user's
// token can read them, and that's what "linked" means here.

/** Anryh Labs' Business Manager ID (named "Clync" in Meta), the one agents send their partner request to. */
export const META_BUSINESS_ID = process.env.META_BUSINESS_ID || "1543106851189409";

/** "act_123", "123", or an Ads Manager link with act=123, as act_123; null when it isn't one. */
export function adAccountFrom(input: string): string | null {
  const s = input.trim();
  const fromLink = s.match(/[?&]act=(\d{5,20})/);
  const digits = fromLink?.[1] ?? s.match(/^(?:act_)?(\d{5,20})$/)?.[1];
  return digits ? `act_${digits}` : null;
}

/** A Page ID, or a facebook.com link to the Page (/name, /profile.php?id=, /people/Name/123), as an ID or username. */
export function pageRefFrom(input: string): string | null {
  const s = input.trim();
  if (/^\d{5,25}$/.test(s)) return s;
  try {
    const url = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    if (!/(^|\.)facebook\.com$/.test(url.hostname) && url.hostname !== "fb.com") return null;
    const id = url.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;
    const parts = url.pathname.split("/").filter(Boolean);
    const numeric = parts.find((p) => /^\d{5,25}$/.test(p));
    if (numeric) return numeric;
    const name = parts[0] === "pg" ? parts[1] : parts[0];
    return name && /^[A-Za-z0-9.\-]{3,80}$/.test(name) && !["profile.php", "people", "pages"].includes(name) ? name : null;
  } catch {
    return null;
  }
}

export type MetaAccess = {
  adAccount: { id: string; name: string } | null;
  page: { id: string; name: string; instagramId: string | null } | null;
};

/** What the Migz system user can reach of what the agent shared: each is null until it's been assigned to us. */
export async function checkMetaAccess(adAccountId: string, pageRef: string): Promise<MetaAccess> {
  const [account, pages] = await Promise.all([
    graph<{ id: string; name: string }>("GET", adAccountId, { fields: "id,name" }).catch(() => null),
    graphAll<{ id: string; name: string; username?: string; instagram_business_account?: { id: string } }>("me/accounts", {
      fields: "id,name,username,instagram_business_account",
      limit: 100,
    }).catch(() => []),
  ]);
  const ref = pageRef.toLowerCase();
  const page = pages.find((p) => p.id === pageRef || p.username?.toLowerCase() === ref) ?? null;
  return {
    adAccount: account?.id ? { id: account.id, name: account.name } : null,
    page: page ? { id: page.id, name: page.name, instagramId: page.instagram_business_account?.id ?? null } : null,
  };
}
