import { describe, expect, test } from "bun:test";
import { sliceTitle } from "../lib/pr-flow.ts";

/** #197 (Sonar S7750): sliceTitle picks the oldest non-merge subject (git log lists the newest first). */
describe("sonar197-findlast: sliceTitle", () => {
  test("takes the oldest commit that is not a merge, without its prefix and PR number", () => {
    expect(
      sliceTitle([
        "Merge branch 'main' into topic",
        "feat(b): second change (#12)",
        "Merge pull request #3 from x/y",
        "fix(a): first change (#11)",
      ]),
    ).toBe("first change");
  });

  test("is null when every subject is a merge or there are none", () => {
    expect(sliceTitle(["Merge branch 'main' into topic"])).toBeNull();
    expect(sliceTitle([])).toBeNull();
  });
});
