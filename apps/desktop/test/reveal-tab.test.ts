import { describe, expect, test } from "bun:test";
import { revealTab } from "../src/features/tabs/reveal-tab.ts";

/**
 * #1430: the tab strip keeps the active tab in view by scrolling itself sideways. Not with
 * scrollIntoView: Chromium moves the Tab key's starting point to what it scrolls to, so the first
 * Tab of a wide window went past "Skip to content" into the strip.
 */
const box = (left: number, right: number, scrollLeft = 100) => ({
  getBoundingClientRect: () => ({ left, right }),
  scrollLeft,
});
const tab = (left: number, right: number) => {
  const calls: string[] = [];
  return {
    calls,
    getBoundingClientRect: () => ({ left, right }),
    scrollIntoView: () => calls.push("scrollIntoView"),
  };
};

describe("reveal-tab: the active tab in view, without moving the Tab key's start (#1430)", () => {
  test("a tab past the right edge scrolls the strip right by the overflow, and no further", () => {
    const strip = box(0, 500);
    const active = tab(480, 560);
    revealTab(strip, active);
    expect([strip.scrollLeft, active.calls]).toEqual([160, []]);
  });

  test("a tab before the left edge scrolls the strip left by the gap", () => {
    const strip = box(200, 700);
    revealTab(strip, tab(150, 230));
    expect(strip.scrollLeft).toBe(50);
  });

  test("a tab already in view leaves the strip where it is", () => {
    const strip = box(0, 500);
    revealTab(strip, tab(100, 180));
    expect(strip.scrollLeft).toBe(100);
  });
});
