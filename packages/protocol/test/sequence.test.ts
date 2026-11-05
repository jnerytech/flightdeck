import { describe, expect, test } from "bun:test";
import { inSequence } from "../src/sequence.ts";

describe("sequence: inSequence", () => {
  test("gives back what each step returned, in the order of the items", async () => {
    expect(await inSequence([1, 2, 3], async (n) => n * 10)).toEqual([10, 20, 30]);
  });

  test("the next step starts only after the one before has finished", async () => {
    const events: string[] = [];
    await inSequence(["a", "b", "c"], async (name) => {
      events.push(`start ${name}`);
      await Bun.sleep(name === "a" ? 30 : 1);
      events.push(`end ${name}`);
    });
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  test("a step gets the index of its item", async () => {
    expect(await inSequence(["x", "y"], (item, index) => `${index}:${item}`)).toEqual([
      "0:x",
      "1:y",
    ]);
  });

  test("any iterable works, a plain return value included", async () => {
    expect(await inSequence(new Set([1, 2]), (n) => n + 1)).toEqual([2, 3]);
  });

  test("no items, no steps", async () => {
    expect(await inSequence([], () => 1)).toEqual([]);
  });

  test("a step that fails stops the ones after it and rejects", async () => {
    const seen: number[] = [];
    const run = inSequence([1, 2, 3], async (n) => {
      seen.push(n);
      if (n === 2) throw new Error("boom");
    });
    await expect(run).rejects.toThrow("boom");
    expect(seen).toEqual([1, 2]);
  });
});
