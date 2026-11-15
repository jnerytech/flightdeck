import { describe, expect, test } from "bun:test";
import { heldMoved, resolvedRound } from "../../src/watch/domain/held-round.ts";

const SHA = "a".repeat(40);
const BASE = "b".repeat(40);

/** Issue #77: the answer to a held round is applied only while the branch stands where it was held. */
describe("held-round: whether the branch moved since a round was held (#77)", () => {
  test("a push stands while HEAD is the held commit, whatever the round's start", () => {
    expect(heldMoved("push", { sha: SHA, base: "" }, SHA)).toBe(false);
  });

  test("a push is refused when HEAD is another commit", () => {
    expect(heldMoved("push", { sha: SHA, base: BASE }, BASE)).toBe(true);
  });

  test("a held commit that is not a commit id is refused, for a push and for a drop", () => {
    expect(heldMoved("push", { sha: "--output=x", base: BASE }, "--output=x")).toBe(true);
    expect(heldMoved("drop", { sha: "", base: BASE }, "")).toBe(true);
  });

  test("a drop needs the round's start to be a commit id", () => {
    expect(heldMoved("drop", { sha: SHA, base: BASE }, SHA)).toBe(false);
    expect(heldMoved("drop", { sha: SHA, base: "" }, SHA)).toBe(true);
    expect(heldMoved("drop", { sha: SHA, base: "--keep" }, SHA)).toBe(true);
  });
});

describe("held-round: what a resolved round records (#77)", () => {
  test("a pushed round keeps the summary it was held with", () => {
    expect(resolvedRound("push", "drifted: 2 files")).toEqual({
      status: "pushed",
      summary: "pushed by you after the hold: drifted: 2 files",
    });
    expect(resolvedRound("push", null).summary).toBe("pushed by you after the hold: ");
  });

  test("a dropped round says the branch is back where the round started", () => {
    expect(resolvedRound("drop", "drifted: 2 files")).toEqual({
      status: "stopped",
      summary: "dropped by you: the branch is back where the round started",
    });
  });
});
