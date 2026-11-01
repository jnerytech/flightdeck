import { describe, expect, test } from "bun:test";
import { ENTRY_GZIP_LIMIT, overBudget } from "../lib/bundle-budget.ts";

const chunk = (file: string, gzip: number) => ({ file, bytes: gzip * 3, gzip });

describe("bundle-lazy: the entry chunk stays under its budget", () => {
  test("the limit is the spec's 30% under the baseline of 516,263 bytes gzip", () => {
    expect(ENTRY_GZIP_LIMIT).toBeLessThanOrEqual(Math.floor(516_263 * 0.7));
    expect(ENTRY_GZIP_LIMIT).toBeGreaterThan(300_000);
  });

  test("an entry within the limit passes, however large the lazy chunks are", () => {
    const chunks = [chunk("xterm-deps.js", 900_000), chunk("index.js", 340_000)];
    expect(overBudget(chunks, "index.js")).toEqual([]);
    expect(overBudget(chunks, "index.js", 340_000)).toEqual([]);
  });

  test("an entry over the limit says which chunk, its size and the limit", () => {
    expect(overBudget([chunk("index.js", 400_000)], "index.js", 360_000)).toEqual([
      "entry chunk index.js is 400,000 bytes gzip, over the 360,000 limit",
    ]);
  });

  test("a build with no entry chunk cannot be checked", () => {
    expect(overBudget([chunk("a.js", 1)], null)).toEqual(["no entry chunk found in the build"]);
    expect(overBudget([chunk("a.js", 1)], "index.js")).toEqual([
      "no entry chunk found in the build",
    ]);
  });
});
