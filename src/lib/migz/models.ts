// The model team, in one place. Override any ID with an env var (e.g. MIGZ_MODEL_SONNET) without a deploy.

export type ModelTier = "haiku" | "sonnet" | "opus";

export const MODELS: Record<ModelTier, string> = {
  haiku: process.env.MIGZ_MODEL_HAIKU || "claude-haiku-5-5",
  sonnet: process.env.MIGZ_MODEL_SONNET || "claude-sonnet-5-5",
  opus: process.env.MIGZ_MODEL_OPUS || "claude-opus-5-5",
};

// USD per million tokens (Anthropic first-party list prices). Cache writes bill at 1.25x input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export const WEB_SEARCH_USD_PER_SEARCH = 0.01;

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Estimated cost of one call. Unknown models (env overrides) are priced as the tier they replace. */
export function costUsd(model: string, u: TokenUsage, tier?: ModelTier) {
  const p = PRICES[model] ?? (tier ? PRICES[MODELS[tier]] : undefined) ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1_000_000;
}

export function tierOf(model: string): ModelTier {
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  return "opus";
}

// Server-side refusal fallbacks ("default" routes by refusal category). Haiku has none.
export const supportsFallbacks = (tier: ModelTier) => tier !== "haiku";
