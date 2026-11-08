import { describe, expect, test } from "bun:test";
import { nextStep, opensOnChanges } from "../src/lib/card-next-step.ts";

const card = (over: Record<string, unknown> = {}) =>
  ({
    worktreePath: null,
    sessionId: null,
    sessionStatus: null,
    queued: false,
    prUrl: null,
    prState: null,
    ...over,
  }) as never;
const finished = { worktreePath: "/w", sessionId: "s1", sessionStatus: "ended" };
const view = (tab: "conversation" | "diff" = "conversation", canMerge = true, gate = false) => ({
  tab,
  canMerge,
  gate,
});

describe("card-next-step: the one button a card leads with (#1197)", () => {
  test("a card that never started leads with Start", () => {
    expect(nextStep(card(), view())).toBe("start");
  });

  test("a running or queued card leads with Stop", () => {
    for (const over of [
      { queued: true },
      { sessionStatus: "running", sessionId: "s1", worktreePath: "/w" },
      { sessionStatus: "awaiting_permission", sessionId: "s1", worktreePath: "/w" },
      { sessionStatus: "starting", sessionId: "s1", worktreePath: "/w" },
    ]) {
      expect(nextStep(card(over), view())).toBe("stop");
    }
  });

  test("a finished run leads with Review changes until the changes are on show, then Open PR", () => {
    expect(nextStep(card(finished), view("conversation"))).toBe("review");
    expect(nextStep(card(finished), view("diff"))).toBe("open-pr");
    expect(nextStep(card({ ...finished, sessionStatus: "idle" }), view())).toBe("review");
    expect(nextStep(card({ ...finished, sessionId: null, sessionStatus: null }), view())).toBe(
      "review",
    );
  });

  test("a card with an open PR leads with Merge PR where the host can merge, else with nothing", () => {
    const withPr = { ...finished, prUrl: "https://x/pr/1", prState: "open" };
    expect(nextStep(card(withPr), view("conversation", true))).toBe("merge-pr");
    expect(nextStep(card(withPr), view("diff", true))).toBe("merge-pr");
    expect(nextStep(card(withPr), view("conversation", false))).toBeNull();
    expect(nextStep(card({ ...withPr, prState: null }), view("conversation", true))).toBe(
      "merge-pr",
    );
  });

  test("a run waiting at a gate leads with the gate, never with Open PR or Merge PR (#1269)", () => {
    expect(nextStep(card(finished), view("diff", true, true))).toBe("gate");
    expect(nextStep(card(finished), view("conversation", true, true))).toBe("gate");
    const withPr = { ...finished, prUrl: "https://x/pr/1", prState: "open" };
    expect(nextStep(card(withPr), view("conversation", true, true))).toBe("gate");
    // A card that never started has no run to wait on, and a live session still leads with Stop.
    expect(
      nextStep(card({ sessionStatus: "running", sessionId: "s1" }), view("diff", true, true)),
    ).toBe("stop");
  });

  test("a merged or closed PR leaves nothing waiting", () => {
    for (const prState of ["merged", "closed"]) {
      const done = { ...finished, prUrl: "https://x/pr/1", prState };
      expect(nextStep(card(done), view("conversation", true))).toBeNull();
    }
  });

  test("only a finished run with a worktree and no PR opens on its changes", () => {
    expect(opensOnChanges(card(finished))).toBe(true);
    expect(opensOnChanges(card({ ...finished, sessionStatus: "idle" }))).toBe(true);
    expect(opensOnChanges(card())).toBe(false);
    expect(opensOnChanges(card({ ...finished, sessionStatus: "running" }))).toBe(false);
    expect(opensOnChanges(card({ ...finished, prUrl: "https://x/pr/1", prState: "open" }))).toBe(
      false,
    );
    expect(opensOnChanges(card({ queued: true, worktreePath: "/w" }))).toBe(false);
  });
});
