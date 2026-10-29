import { z } from "zod";
import type { UsageTokens } from "./usage-indexer.ts";

/** API prices of a model, in US$ per million tokens. */
export const ModelPrice = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  /**
   * Prices above a prompt size (input, cache read and cache write), in ascending order: the last
   * one the prompt goes over applies.
   */
  tiers: z
    .array(
      z.object({
        abovePromptTokens: z.number().int().min(0),
        input: z.number().min(0),
        output: z.number().min(0),
      }),
    )
    .optional(),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

/** `pricing` in the config: overrides of the default table, model by model. */
export const PricingConfig = z.object({
  models: z.record(z.string(), ModelPrice).default({}),
  cacheWrite5mMultiplier: z.number().min(0).optional(),
  cacheWrite1hMultiplier: z.number().min(0).optional(),
  fastMultiplier: z.record(z.string(), z.number().min(0)).default({}),
});
export type PricingConfig = z.infer<typeof PricingConfig>;

/** The table in use: defaults with the config's overrides. */
export interface Pricing {
  models: Record<string, ModelPrice>;
  /** Cache writes cost the input price times these. */
  cacheWrite5mMultiplier: number;
  cacheWrite1hMultiplier: number;
  /** Fast mode multiplies the whole message, per model. */
  fastMultiplier: Record<string, number>;
}

/** When the default table was taken from the API price page (docs/DECISIONS.md). */
export const PRICING_DATE = "2026-10-06";

/** The API prices of 2026-10-06; Haiku's cache read is the API's rule of 0.1× the input. */
export const DEFAULT_PRICING: Pricing = {
  models: {
    "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
    "claude-haiku-5-5": {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      tiers: [{ abovePromptTokens: 100_000, input: 0.5, output: 2.5 }],
    },
  },
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2,
  fastMultiplier: { "claude-opus-5-5": 2 },
};

/** The default table with the config's overrides: a model in the config replaces the default one. */
export function resolvePricing(config?: PricingConfig): Pricing {
  return {
    models: { ...DEFAULT_PRICING.models, ...config?.models },
    cacheWrite5mMultiplier:
      config?.cacheWrite5mMultiplier ?? DEFAULT_PRICING.cacheWrite5mMultiplier,
    cacheWrite1hMultiplier:
      config?.cacheWrite1hMultiplier ?? DEFAULT_PRICING.cacheWrite1hMultiplier,
    fastMultiplier: { ...DEFAULT_PRICING.fastMultiplier, ...config?.fastMultiplier },
  };
}

/**
 * Estimated cost of a message in US$; `null` when its model has no price. Above a tier's prompt
 * size (input, cache read and cache write together) the tier's input and output apply, cache
 * writes included; cache reads keep the model's price.
 */
export function costOf(tokens: UsageTokens, pricing: Pricing): number | null {
  const price = pricing.models[tokens.model];
  if (!price) return null;
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;
  const tier = (price.tiers ?? []).filter((t) => prompt > t.abovePromptTokens).at(-1);
  const input = tier?.input ?? price.input;
  const output = tier?.output ?? price.output;
  const perMillion =
    tokens.input * input +
    tokens.output * output +
    tokens.cacheRead * price.cacheRead +
    tokens.cacheWrite5m * input * pricing.cacheWrite5mMultiplier +
    tokens.cacheWrite1h * input * pricing.cacheWrite1hMultiplier;
  const fast = tokens.speed === "fast" ? (pricing.fastMultiplier[tokens.model] ?? 1) : 1;
  return (perMillion / 1_000_000) * fast;
}
