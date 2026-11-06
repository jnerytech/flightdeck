import { describe, expect, test } from "bun:test";
import { pollUntil } from "../lib/poll.ts";

describe("poll: waiting for a thing to happen", () => {
  test("the first value that is not empty is what it gives, a sync check or an async one", async () => {
    expect(
      await pollUntil(
        () => "ready",
        () => new Error("late"),
        1000,
        5,
      ),
    ).toBe("ready");
    expect(
      await pollUntil(
        async () => 42,
        () => new Error("late"),
        1000,
        5,
      ),
    ).toBe(42);
  });

  test("it looks again until the check gives something", async () => {
    let looks = 0;
    const value = await pollUntil(
      () => (++looks === 4 ? "now" : null),
      () => new Error("late"),
      2000,
      1,
    );
    expect(value).toBe("now");
    expect(looks).toBe(4);
  });

  test("nothing, false and undefined are not an answer", async () => {
    const answers = [null, false, undefined, "yes"];
    expect(
      await pollUntil(
        () => answers.shift(),
        () => new Error("late"),
        2000,
        1,
      ),
    ).toBe("yes");
  });

  test("past the limit it fails with the error it was given", async () => {
    await expect(
      pollUntil(
        () => null,
        () => new Error("timeout: a thing"),
        30,
        5,
      ),
    ).rejects.toThrow("timeout: a thing");
  });
});
