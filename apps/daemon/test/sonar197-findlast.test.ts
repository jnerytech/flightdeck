import { describe, expect, test } from "bun:test";
import { costOf, type Pricing } from "../src/costs/pricing.ts";
import type { UsageTokens } from "../src/costs/usage-indexer.ts";

/** #197 (Sonar S7750): "the last one that matches" stays the last one that matches. */
const M = 1_000_000;
const PRICING: Pricing = {
  models: {
    m: {
      input: 1,
      output: 10,
      cacheRead: 0,
      tiers: [
        { abovePromptTokens: 100_000, input: 2, output: 20 },
        { abovePromptTokens: 200_000, input: 3, output: 30 },
      ],
    },
  },
  cacheWrite5mMultiplier: 1,
  cacheWrite1hMultiplier: 1,
  fastMultiplier: {},
};
const usage = (input: number): UsageTokens => ({
  model: "m",
  speed: "standard",
  input,
  output: M,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
});

describe("sonar197-findlast: costOf tiers", () => {
  test("the highest tier the prompt crosses prices the message", () => {
    expect(costOf(usage(50_000), PRICING)).toBeCloseTo((50_000 * 1 + M * 10) / M);
    expect(costOf(usage(150_000), PRICING)).toBeCloseTo((150_000 * 2 + M * 20) / M);
    expect(costOf(usage(250_000), PRICING)).toBeCloseTo((250_000 * 3 + M * 30) / M);
  });
});
