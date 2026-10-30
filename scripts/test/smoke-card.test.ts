import { describe, expect, test } from "bun:test";
import { describeCard } from "../lib/smoke-card.ts";

describe("smoke-card: what a timed-out smoke says about its card", () => {
  test("names the column, the worktree, the PR and checks states and the notice", () => {
    expect(
      describeCard({
        column: "review",
        worktreePath: "/tmp/wt",
        prState: "merged",
        checksState: "passing",
        notice: "git worktree remove: locked",
      }),
    ).toBe(
      "column=review worktree=/tmp/wt pr=merged checks=passing notice=git worktree remove: locked",
    );
  });

  test("a missing worktree, state or notice reads as none, and no card as no card", () => {
    expect(describeCard({ column: "done", worktreePath: null })).toBe(
      "column=done worktree=none pr=none checks=none notice=none",
    );
    expect(describeCard(undefined)).toBe("no card update seen");
  });
});
