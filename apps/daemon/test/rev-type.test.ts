import { describe, expect, test } from "bun:test";
import { cardDiff } from "../src/board/diff.ts";
import { aheadBehind, assertLocalBranch, mergeIntoBase, rebaseOnto } from "../src/board/merge.ts";
import { assertBranchName, type Rev, refArg } from "../src/board/ref-arg.ts";
import { freshBase } from "../src/board/worktree.ts";
import { workflowSources } from "../src/workflows/repo.ts";

/**
 * Not called: this is a type test. `bun run typecheck` fails on a `@ts-expect-error` that finds no
 * error, so a git helper that takes a plain string for a revision fails the typecheck (issue #369).
 */
export const typeTest = () => {
  const base: Rev = refArg("main");
  const other: Rev = assertBranchName("release/1");
  // @ts-expect-error a string typed by hand is not a Rev
  const bad: Rev = "main";
  void bad;

  void aheadBehind("/w", base);
  void aheadBehind("/w", base, other);
  // @ts-expect-error the base of aheadBehind is a Rev
  void aheadBehind("/w", "main");
  // @ts-expect-error the ref of aheadBehind is a Rev
  void aheadBehind("/w", base, "feature");

  void assertLocalBranch("/r", base);
  // @ts-expect-error the base of assertLocalBranch is a Rev
  void assertLocalBranch("/r", "main");

  void rebaseOnto("/w", base);
  // @ts-expect-error the base of rebaseOnto is a Rev
  void rebaseOnto("/w", "main");

  void mergeIntoBase("/r", base, other, "merge", "m");
  // @ts-expect-error the base of mergeIntoBase is a Rev
  void mergeIntoBase("/r", "main", other, "merge", "m");
  // @ts-expect-error the branch of mergeIntoBase is a Rev
  void mergeIntoBase("/r", base, "feature", "merge", "m");

  void freshBase("/r", base);
  // @ts-expect-error the base of freshBase is a Rev
  void freshBase("/r", "main");

  void workflowSources("/r", base);
  // @ts-expect-error the base of workflowSources is a Rev
  void workflowSources("/r", "main");

  void cardDiff("/w", base);
  // @ts-expect-error the base of cardDiff is a Rev
  void cardDiff("/w", "main");
};

describe("rev-type: a revision is checked once, where it comes in, and the type says so (issue #369)", () => {
  test("refArg and assertBranchName hand back the name they checked", () => {
    expect(refArg("main")).toBe("main");
    expect(refArg("origin/main")).toBe("origin/main");
    expect(refArg("HEAD")).toBe("HEAD");
    expect(assertBranchName("release/1.2")).toBe("release/1.2");
  });

  test("an option, an empty name and a name git refuses never become a Rev", () => {
    for (const name of ["-x", "--output=/tmp/x", "-", ""]) {
      expect(() => refArg(name)).toThrow("not a valid branch name");
    }
    for (const name of ["-x", "a..b", "x.lock", "@/tmp/x", "HEAD"]) {
      expect(() => assertBranchName(name)).toThrow("not a valid branch name");
    }
  });
});
