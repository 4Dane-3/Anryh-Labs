import "server-only";

// Integration seams. Each flips on when its keys are present; the dashboard shows a
// "not connected" state until then. The actual API calls get added when the keys are in hand.

export const integrations = {
  /** Meta Marketing API for Migz AI: campaign management, Insights sync into ad_metrics_daily, ad_actions log. */
  meta: Boolean(process.env.META_SYSTEM_USER_TOKEN && process.env.META_AD_ACCOUNT_ID),
  /** Stripe: Checkout for "Add funds", webhook writes deposits to wallet_transactions. */
  stripe: Boolean(process.env.STRIPE_SECRET_KEY),
  /** Slack bot for booking alerts and the morning digest (already live). */
  slack: Boolean(process.env.SLACK_BOT_TOKEN),
};
