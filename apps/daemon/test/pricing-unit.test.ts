import { describe, expect, test } from "bun:test";
import { costOf, DEFAULT_PRICING, resolvePricing } from "../src/costs/pricing.ts";
import type { UsageTokens } from "../src/costs/usage-indexer.ts";

const M = 1_000_000;
const tokens = (fields: Partial<UsageTokens>): UsageTokens => ({
  model: "claude-opus-5-5",
  speed: "standard",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  ...fields,
});

describe("pricing-unit: what a message cost", () => {
  test("input and output are priced per million tokens of the model", () => {
    expect(costOf(tokens({ input: M, output: M }), DEFAULT_PRICING)).toBeCloseTo(4 + 20, 9);
  });

  test("a cache write costs the input price times 1.25 (5 minutes) or 2 (1 hour); a cache read has its own price", () => {
    expect({
      write5m: costOf(tokens({ cacheWrite5m: M }), DEFAULT_PRICING),
      write1h: costOf(tokens({ cacheWrite1h: M }), DEFAULT_PRICING),
      read: costOf(tokens({ cacheRead: M }), DEFAULT_PRICING),
    }).toEqual({ write5m: 5, write1h: 8, read: 0.2 });
  });

  test("a prompt over a tier's size is priced at the tier, and one exactly at the size is not", () => {
    const haiku = (input: number) => tokens({ model: "claude-haiku-5-5", input });
    expect({
      over: costOf(haiku(200_000), DEFAULT_PRICING),
      at: costOf(haiku(100_000), DEFAULT_PRICING),
    }).toEqual({ over: 0.1, at: 0.01 });
  });

  test("fast mode multiplies the message for the models that have a multiplier, and no other", () => {
    expect({
      opus: costOf(tokens({ input: M, speed: "fast" }), DEFAULT_PRICING),
      sonnet: costOf(
        tokens({ model: "claude-sonnet-5-5", input: M, speed: "fast" }),
        DEFAULT_PRICING,
      ),
    }).toEqual({ opus: 8, sonnet: 2 });
  });

  test("a model with no price has no cost, not zero", () => {
    expect(costOf(tokens({ model: "claude-mystery-9", input: M }), DEFAULT_PRICING)).toBeNull();
  });
});

describe("pricing-unit: the config overrides the default table", () => {
  test("a model in the config replaces the default one, and the other defaults stay", () => {
    const pricing = resolvePricing({
      models: { "claude-opus-5-5": { input: 1, output: 1, cacheRead: 1 } },
      fastMultiplier: {},
      cacheWrite5mMultiplier: 3,
    });
    expect({
      opus: costOf(tokens({ input: M }), pricing),
      sonnetStays: pricing.models["claude-sonnet-5-5"]?.input,
      write5m: costOf(tokens({ cacheWrite5m: M }), pricing),
      write1hDefault: pricing.cacheWrite1hMultiplier,
      fastDefaultKept: pricing.fastMultiplier["claude-opus-5-5"],
    }).toEqual({ opus: 1, sonnetStays: 2, write5m: 3, write1hDefault: 2, fastDefaultKept: 2 });
  });

  test("no config is the default table", () => {
    expect(resolvePricing()).toEqual(DEFAULT_PRICING);
  });
});
