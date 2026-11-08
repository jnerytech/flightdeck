import { describe, expect, test } from "bun:test";
import { firstBracketed } from "../src/boardsync/github.ts";
import { versionOf } from "../src/deps/deps.ts";

/**
 * Issue #363 (Sonar S8786): small scanners over text that other programs or other people wrote
 * (a gh error, a `--version` line) read it in one pass. Each one has its answers pinned, and a
 * worst-case input that must be read in a moment: with the regex they had, the time grew with the
 * square of the length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("text-scan-linear: firstBracketed (the scopes gh says are missing)", () => {
  test.each([
    ["x [project] y", "project"],
    ["needs [read:project, project]", "read:project, project"],
    ["[][a]", "a"],
    ["[[a]", "[a"],
    ["[ ]", " "],
    ["a]b[c]", "c"],
    ["[]", undefined],
    ["[", undefined],
    ["no brackets", undefined],
    ["[a", undefined],
    ["", undefined],
  ])("%j gives %j", (text, expected) => {
    expect(firstBracketed(text)).toBe(expected);
  });

  test("a long text of opening brackets is read in a moment", () => {
    expect(took(() => firstBracketed("[".repeat(120_000)))).toBeLessThan(FAST_MS);
  });

  test("a long text of empty pairs is read in a moment", () => {
    expect(took(() => firstBracketed("[]".repeat(60_000)))).toBeLessThan(FAST_MS);
  });
});

describe("text-scan-linear: versionOf (the first version in a --version line)", () => {
  test.each([
    ["git version 2.43.0", "2.43.0"],
    ["bun 1.4", "1.4"],
    ["tool v10.2.3.4 (build 7.1)", "10.2.3.4"],
    ["no number 12 here", undefined],
    ["12 then 3.4", "3.4"],
    ["1.x 2.5", "2.5"],
    ["abc1.2", "1.2"],
    ["3.", undefined],
    ["", undefined],
    [null, undefined],
  ])("%j gives %j", (text, expected) => {
    expect(versionOf(text)).toBe(expected);
  });

  test("a long run of digits with no dot is read in a moment", () => {
    expect(took(() => versionOf("1".repeat(120_000)))).toBeLessThan(FAST_MS);
  });

  test("a long run of digits and dots is read in a moment", () => {
    expect(took(() => versionOf(`${"1.".repeat(60_000)}x`))).toBeLessThan(FAST_MS);
  });
});
