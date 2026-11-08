import { describe, expect, test } from "bun:test";
import { pollUntil } from "../lib/smoke-poll";

const QUICK = { timeoutMs: 1000, pauseMs: 1 };

describe("pollUntil", () => {
  test("gives the first value the check finds, looking once per pause", async () => {
    let looks = 0;
    const found = await pollUntil(() => (++looks < 3 ? null : "ready"), "the thing", QUICK);
    expect(found).toBe("ready");
    expect(looks).toBe(3);
  });

  test("waits for a check that answers later", async () => {
    let looks = 0;
    const found = await pollUntil(
      async () => (++looks < 2 ? false : { id: looks }),
      "the thing",
      QUICK,
    );
    expect(found).toEqual({ id: 2 });
  });

  test("looks once even when the time is already up, and returns what it finds", async () => {
    const found = await pollUntil(() => 7, "the thing", { timeoutMs: 0, pauseMs: 1 });
    expect(found).toBe(7);
  });

  test("names what it waited for when the time runs out", async () => {
    let looks = 0;
    const waiting = pollUntil(
      () => {
        looks++;
        return undefined;
      },
      "the card to start",
      { timeoutMs: 20, pauseMs: 2 },
    );
    await expect(waiting).rejects.toThrow("timeout: the card to start");
    expect(looks).toBeGreaterThan(1);
  });
});
