import { describe, expect, test } from "bun:test";
import { PENDING_SELECTOR, pendingSelectorFor } from "../../lib/shots/loaded.ts";

describe("what a print waits out before the shot (#4001)", () => {
  test("a print waits for every busy region and skeleton to clear", () => {
    expect(pendingSelectorFor({})).toBe(PENDING_SELECTOR);
  });

  test("a print of a cleanup held in progress waits for skeletons and busy regions, but not for a busy button", () => {
    const selector = pendingSelectorFor({ maintenance: { holdClean: true } });
    expect(selector).toContain('[data-slot="skeleton"]');
    expect(selector).toContain('[aria-busy="true"]:not(button)');
    expect(selector).not.toBe(PENDING_SELECTOR);
  });
});
