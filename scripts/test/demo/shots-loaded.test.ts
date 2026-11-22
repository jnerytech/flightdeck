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

  test("a print of an answer left on its way waits for skeletons and busy regions, but not for the busy button (#4203)", () => {
    const selector = pendingSelectorFor({
      wire: [{ command: "permission.respond", stall: true }],
    });
    expect(selector).toContain('[aria-busy="true"]:not(button)');
  });

  test("a print whose list is held on purpose (#4190) waits for a busy region that is not the loading status, and for no skeleton", () => {
    const selector = pendingSelectorFor({ wire: [{ command: "automation.list", hold: true }] });
    expect({
      busyExceptStatus: selector.includes('[aria-busy="true"]:not([role="status"])'),
      skeleton: selector.includes("skeleton"),
    }).toEqual({ busyExceptStatus: true, skeleton: false });
  });

  test("a wire rule that is not a hold leaves the selector as it is", () => {
    expect(pendingSelectorFor({ wire: [{ command: "automation.list", refuse: "no" }] })).toBe(
      PENDING_SELECTOR,
    );
  });
});
