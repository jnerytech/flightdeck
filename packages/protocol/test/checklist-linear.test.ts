import { describe, expect, test } from "bun:test";
import { hasChecklistItem } from "../src/board-contracts.ts";

/**
 * Issue #363 (Sonar S8786): whether a card's description has a checklist item is read in one pass.
 * A description comes from the person, a GitHub issue or a pull request, so its length is not
 * bounded: with the pattern it had, `^\s*` is tried at every line start and crosses the line breaks,
 * so a long run of blank lines took time that grew with the square of its length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("checklist-linear: hasChecklistItem", () => {
  test.each([
    ["- [ ] a", true],
    ["* [x] a", true],
    ["- [X] a", true],
    ["  - [ ] a", true],
    ["\t- [ ]\ta", true],
    ["- [ ]\n", true],
    ["a\n- [ ] b", true],
    ["a\r\n- [ ] b", true],
    ["a\r- [ ] b", true],
    ["a - [ ] b", true],
    ["a - [ ] b", true],
    ["\n\n  * [x] y", true],
    ["a\n\n\n   \n- [ ] b", true],
    ["-\n[ ] x", true],
    ["-  \n  [x]\n", true],
    ["- [ ]", false],
    ["- [ ]x", false],
    ["-[ ] a", false],
    ["- [] a", false],
    ["- [  ] a", false],
    ["- [y] a", false],
    ["- [-] a", false],
    ["+ [ ] a", false],
    ["1. [ ] a", false],
    ["text - [ ] a", false],
    ["a - [ ] b\n", false],
    ["- text [ ] a", false],
    ["--- [ ] a", false],
    ["", false],
    ["\n\n", false],
    ["no list here", false],
  ])("%j gives %j", (text, expected) => {
    expect(hasChecklistItem(text)).toBe(expected);
  });

  test("the first line that is an item decides, wherever it is", () => {
    expect(hasChecklistItem(`${"- x\n".repeat(50)}- [ ] done`)).toBe(true);
    expect(hasChecklistItem(`${"- [ ]x\n".repeat(50)}- [ ] done`)).toBe(true);
    expect(hasChecklistItem("- [ ]x\n- [ ]y\n")).toBe(false);
  });

  test("a long run of blank lines or spaces is read in a moment", () => {
    expect(took(() => hasChecklistItem("\n".repeat(40_000)))).toBeLessThan(FAST_MS);
    expect(took(() => hasChecklistItem(`${"\n ".repeat(20_000)}x`))).toBeLessThan(FAST_MS);
    expect(took(() => hasChecklistItem(" ".repeat(60_000)))).toBeLessThan(FAST_MS);
  });

  test("a long text of dashes, brackets and lines that almost match is read in a moment", () => {
    expect(took(() => hasChecklistItem("- ".repeat(40_000)))).toBeLessThan(FAST_MS);
    expect(took(() => hasChecklistItem("-\n".repeat(40_000)))).toBeLessThan(FAST_MS);
    expect(took(() => hasChecklistItem("- [ ".repeat(20_000)))).toBeLessThan(FAST_MS);
    expect(took(() => hasChecklistItem("- [ ]x\n".repeat(20_000)))).toBeLessThan(FAST_MS);
    expect(took(() => hasChecklistItem(`-${" ".repeat(60_000)}x`))).toBeLessThan(FAST_MS);
  });
});
