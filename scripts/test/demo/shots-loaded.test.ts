import { describe, expect, test } from "bun:test";
import { PENDING_SELECTOR, pendingSelectorFor } from "../../lib/shots/loaded.ts";

describe("what a print waits out before the shot (#4001)", () => {
  test("a print waits for every busy region and skeleton to clear", () => {
    expect(pendingSelectorFor({})).toBe(PENDING_SELECTOR);
  });

  test("a print of a task held in progress still waits for the skeletons, not for the busy region", () => {
    const selector = pendingSelectorFor({ busy: true });
    expect(selector).toContain('[data-slot="skeleton"]');
    expect(selector).not.toContain("aria-busy");
  });
});
