import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { holdsAsync } from "../../../../scripts/test/property.ts";
import { inSequence } from "../../src/sequence.ts";

describe("sequence: properties of inSequence", () => {
  test("gives back one result per item, in the order of the items, with the index of each", async () => {
    await holdsAsync(
      fc.asyncProperty(fc.array(fc.integer()), async (items) => {
        const results = await inSequence(items, (item, index) => [index, item]);
        expect(results).toEqual(items.map((item, index) => [index, item]));
      }),
    );
  });

  test("two steps never run at the same time, even when each one waits", async () => {
    await holdsAsync(
      fc.asyncProperty(fc.array(fc.nat(3), { maxLength: 12 }), async (waits) => {
        let active = 0;
        let most = 0;
        const started: number[] = [];
        await inSequence(waits, async (turns, index) => {
          started.push(index);
          active++;
          most = Math.max(most, active);
          for (let turn = 0; turn < turns; turn++) await Promise.resolve();
          active--;
        });
        expect(most).toBeLessThanOrEqual(1);
        expect(started).toEqual(waits.map((_, index) => index));
      }),
    );
  });

  test("a step that throws stops the sequence: the ones after it never start", async () => {
    await holdsAsync(
      fc.asyncProperty(
        fc
          .integer({ min: 1, max: 12 })
          .chain((length) =>
            fc.tuple(fc.constant(length), fc.integer({ min: 0, max: length - 1 })),
          ),
        async ([length, failAt]) => {
          const started: number[] = [];
          const run = inSequence(
            Array.from({ length }, (_, index) => index),
            async (index) => {
              started.push(index);
              if (index === failAt) throw new Error("boom");
            },
          );
          await expect(run).rejects.toThrow("boom");
          expect(started).toEqual(Array.from({ length: failAt + 1 }, (_, index) => index));
        },
      ),
    );
  });
});
