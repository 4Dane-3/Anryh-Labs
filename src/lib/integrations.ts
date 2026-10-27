import "server-only";
import type { Agent } from "@/lib/booking/data";
import { stripeReady } from "@/lib/stripe";

// Integration switches. Each turns on when its keys are present; the dashboard shows a
// "not connected" state until then.
export const integrations = {
  /** Meta Marketing API via a Business Manager system user (Migz manages campaigns with it). */
  meta: Boolean(process.env.META_SYSTEM_USER_TOKEN),
  /** Pixel used for LEAD optimization and Conversions API events. */
  metaPixel: Boolean(process.env.META_PIXEL_ID),
  /** ElevenLabs: speaks the narrator's voiceover laid over Migz videos. */
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  /** Higgsfield video generation for Migz-made creatives. */
  higgsfield: Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET),
  /** Claude, the model behind Migz's decisions. */
  claude: Boolean(process.env.ANTHROPIC_API_KEY),
  /** Stripe: Checkout for "Add funds", webhook writes deposits to wallet_transactions (live keys only on Production). */
  stripe: stripeReady(),
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
