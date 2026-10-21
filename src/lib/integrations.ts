import "server-only";
import type { Agent } from "@/lib/booking/data";

// Integration switches. Each turns on when its keys are present; the dashboard shows a
// "not connected" state until then.
export const integrations = {
  /** Meta Marketing API via a Business Manager system user (Migz manages campaigns with it). */
  meta: Boolean(process.env.META_SYSTEM_USER_TOKEN),
  /** Pixel used for SCHEDULE optimization and Conversions API events. */
  metaPixel: Boolean(process.env.META_PIXEL_ID),
  /** Higgsfield video generation for Migz-made creatives. */
  higgsfield: Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET),
  /** Claude, the model behind Migz's decisions. */
  claude: Boolean(process.env.ANTHROPIC_API_KEY),
  /** Stripe: Checkout for "Add funds", webhook writes deposits to wallet_transactions. */
  stripe: Boolean(process.env.STRIPE_SECRET_KEY),
  /** Slack bot for booking alerts and the morning digest. */
  slack: Boolean(process.env.SLACK_BOT_TOKEN),
};

/** Everything Migz needs to manage this agent's ads: platform keys plus the agent's own Meta assets. */
export function migzReadyFor(agent: Pick<Agent, "meta_ad_account_id" | "meta_page_id">) {
  return (
    integrations.meta &&
    integrations.metaPixel &&
    integrations.claude &&
    !!agent.meta_ad_account_id &&
    !!agent.meta_page_id
  );
}
