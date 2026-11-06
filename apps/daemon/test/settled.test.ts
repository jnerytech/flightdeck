import { describe, expect, test } from "bun:test";
import { settled } from "../src/settled.ts";

describe("settled: a sync body behind an async contract", () => {
  test("the value of the work is what the promise gives", async () => {
    expect(await settled(() => 42)).toBe(42);
  });

  test("a promise the work returns is followed, not nested", async () => {
    expect(await settled(() => Promise.resolve("x"))).toBe("x");
  });

  test("what the work throws is a rejection, never an exception", async () => {
    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = settled(() => {
        throw new Error("boom");
      });
    }).not.toThrow();
    await expect(promise).rejects.toThrow("boom");
  });

  test("the work runs at once, as the body of an async function does", () => {
    const seen: string[] = [];
    void settled(() => seen.push("ran"));
    expect(seen).toEqual(["ran"]);
  });
});
