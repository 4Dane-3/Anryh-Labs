import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { googleAdsReady, managerId, request, search } from "@/lib/google-ads/api";
import { customerResource } from "@/lib/google-ads/ids";

// A roofer's Google Ads account and its link to Anryh Labs' manager account. Either they already have one (we
// send a link request; they accept it under Admin → Access and security → Managers in Google Ads) or we make one
// under our manager account and invite them as its admin, so it's theirs: they add their own billing and keep it
// if they ever leave.

export type LinkStatus = "pending" | "linked" | "created" | "refused" | "ended";

export type GoogleAccount = {
  agent_id: string;
  customer_id: string;
  link_status: LinkStatus;
  link_resource: string | null;
  invite_email: string | null;
  monthly_cap_cents: number;
  enabled: boolean;
  campaign_id: string | null;
  budget_resource: string | null;
  conversion_actions: { booked?: string; call?: string; closed?: string };
  launched_at: string | null;
  last_budget_change_at: string | null;
  last_bidding_change_at: string | null;
  snapshot: unknown;
  synced_at: string | null;
  reviewed_at: string | null;
  review_claimed_at: string | null;
  failed_at: string | null;
  fail_count: number;
  last_error: string | null;
};

/** Whether Migz can manage the account (linked, or made by us). */
export const manageable = (a: Pick<GoogleAccount, "link_status"> | null | undefined) => a?.link_status === "linked" || a?.link_status === "created";

/** Null when there's none, or before the Google Ads migration. */
export async function getGoogleAccount(agentId: string): Promise<GoogleAccount | null> {
  const { data, error } = await supabaseAdmin.from("google_ads_accounts").select("*").eq("agent_id", agentId).maybeSingle();
  if (error) return null;
  return (data as GoogleAccount | null) ?? null;
}

export async function saveGoogleAccount(agentId: string, fields: Partial<GoogleAccount>) {
  return supabaseAdmin
    .from("google_ads_accounts")
    .upsert({ agent_id: agentId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "agent_id" });
}

/** Sends a link request from our manager account to theirs. They accept it in Google Ads. */
export async function sendLinkRequest(customerId: string) {
  const res = await request<{ result?: { resourceName?: string } }>(`customers/${managerId()}/customerClientLinks:mutate`, {
    operation: { create: { clientCustomer: customerResource(customerId), status: "PENDING" } },
  });
  return res.result?.resourceName ?? null;
}

const STATUS: Record<string, LinkStatus> = { ACTIVE: "linked", PENDING: "pending", REFUSED: "refused", CANCELED: "ended", INACTIVE: "ended" };

/** The link's state as our manager account sees it (null when there's no link at all). */
export async function linkStatus(customerId: string): Promise<LinkStatus | null> {
  const rows = await search<{ customerClientLink?: { status?: string } }>(
    managerId(),
    `SELECT customer_client_link.client_customer, customer_client_link.status FROM customer_client_link WHERE customer_client_link.client_customer = '${customerResource(customerId)}'`,
  );
  const statuses = rows.map((r) => r.customerClientLink?.status ?? "");
  if (statuses.includes("ACTIVE")) return "linked";
  const s = statuses[0];
  return s ? (STATUS[s] ?? null) : null;
}

/**
 * Makes a new Google Ads account under our manager account and invites `email` as its admin. Google emails them
 * the invitation; once they accept and add billing, ads can run.
 */
export async function createClientAccount(input: { name: string; email: string; timeZone: string }) {
  const res = await request<{ resourceName?: string; invitationLink?: string }>(`customers/${managerId()}:createCustomerClient`, {
    customerClient: { descriptiveName: input.name.slice(0, 120), currencyCode: "USD", timeZone: input.timeZone },
    emailAddress: input.email,
    accessRole: "ADMIN",
  });
  const id = res.resourceName?.split("/").pop() ?? null;
  return { customerId: id && /^\d{10}$/.test(id) ? id : null, invitationLink: res.invitationLink ?? null };
}

/** Rechecks a pending link and saves what changed. Returns the current status. */
export async function refreshLink(agentId: string): Promise<{ account: GoogleAccount | null; changed: boolean }> {
  const account = await getGoogleAccount(agentId);
  if (!account || !googleAdsReady() || account.link_status === "created") return { account, changed: false };
  const now = await linkStatus(account.customer_id).catch(() => null);
  if (!now || now === account.link_status) return { account, changed: false };
  await saveGoogleAccount(agentId, { link_status: now });
  return { account: { ...account, link_status: now }, changed: true };
}
