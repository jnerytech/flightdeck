import { describe, expect, test } from "bun:test";
import { branchPr } from "../lib/branch-pr.ts";

describe("branch-pr (#1115)", () => {
  test("only a PR of this repository whose head is the branch is its own", () => {
    expect(branchPr("12 true a\n13 true b\n", "a")).toEqual({ own: 12, others: [] });
    expect(branchPr("14 false a\n15 true a-2\n", "a")).toEqual({
      own: null,
      others: ["#14 (a, a fork)", "#15 (a-2)"],
    });
    expect(branchPr("", "a")).toEqual({ own: null, others: [] });
  });

  test("#1124 review: a malformed line is skipped, never named as #NaN", () => {
    expect(branchPr("x true a\n\n16\n17 true b\n", "a")).toEqual({
      own: null,
      others: ["#17 (b)"],
    });
  });
});
