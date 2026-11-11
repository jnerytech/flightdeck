import { afterEach, describe, expect, test } from "bun:test";
import { createCosts } from "../../src/costs/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { poll, tempDir } from "../support/helpers.ts";

/**
 * The usage and costs as main.ts builds them (phases 8 and 13, #1593): the costs report the usage
 * index's initial load, a reprice reads the pricing again, and a history change is indexed again.
 */
const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function wired() {
  const listeners: Array<() => void> = [];
  let reads = 0;
  const built = createCosts({
    db: new EventStore(":memory:").db,
    config: {
      pricing: { models: {}, fastMultiplier: {} },
      history: { roots: [tempDir("fd-costs-wiring-")] } as never,
    },
    readPricing: async () => {
      reads++;
      return { models: {}, fastMultiplier: {} };
    },
    excludeCwds: [],
    projectKey: (cwd) => cwd,
    warmKeys: async () => {},
    quota: undefined,
    log: () => {},
    history: { onChange: (listener) => listeners.push(listener) },
  });
  stops.push(
    () => built.usageIndex.stop(),
    () => built.budgets.stop(),
  );
  return { built, listeners, reads: () => reads };
}

describe("costs-wiring: the host's usage index, costs and budgets (#1593)", () => {
  test("the costs report the usage index's initial load, done over an empty history", async () => {
    const { built } = wired();
    await poll(() => built.costs.status().initialLoad.state === "done");
    expect(built.costs.status().initialLoad).toEqual(built.usageIndex.status());
  });

  test("a reprice reads the pricing again", async () => {
    const { built, reads } = wired();
    await built.costs.reprice();
    expect(reads()).toBe(1);
  });

  test("the usage index follows the history index's changes", () => {
    const { listeners } = wired();
    expect(listeners.length).toBe(1);
  });
});
