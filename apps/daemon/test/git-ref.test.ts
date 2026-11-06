import { describe, expect, test } from "bun:test";
import { isBranchName } from "@flightdeck/protocol";
import { git, gitRepo } from "./board-helpers.ts";

/** Names git accepts and refuses (not `@` and `@{-n}`, which are shorthands of the current branch): option-looking ones, every rule of git-check-ref-format, accents and emoji. */
const NAMES = [
  "main",
  "master",
  "release/1.2",
  "feature/ü-é",
  "fix/emoji-🚀",
  "fd/some-card",
  "a",
  "a/b/c",
  "v1.0.0",
  "wip@home",
  "-main",
  "--output=/tmp/stolen",
  "-O/tmp/orderfile",
  "-",
  "--",
  "--end-of-options",
  "",
  "a@{b",
  "a..b",
  "..",
  ".hidden",
  "a/.hidden",
  "a.lock",
  "a/b.lock",
  "a.lock/b",
  "a.",
  "a/",
  "/a",
  "a//b",
  "a b",
  "a\tb",
  "a\nb",
  "a~1",
  "a^",
  "a:b",
  "a?b",
  "a*b",
  "a[b",
  "a\\b",
  "a\u007fb",
  "feature/x.",
  "x/.",
  "refs/heads/main",
  "HEAD",
];

describe("git-ref: a branch name is the one git accepts, and never an option", () => {
  test("every name of the corpus gets the answer of `git check-ref-format --branch`", () => {
    const { repo } = gitRepo();
    const wrong = NAMES.filter((name) => {
      const expected =
        Bun.spawnSync(["git", "check-ref-format", "--branch", name], {
          cwd: repo,
          stdout: "pipe",
          stderr: "pipe",
        }).exitCode === 0;
      return isBranchName(name) !== expected;
    });
    expect(wrong).toEqual([]);
    // The seed repository is a real one: a valid name is also a name git can create.
    expect(git(repo, "branch", "release/1.2")).toBe("");
  });

  test("the shorthands of the current branch are not names", () => {
    expect(isBranchName("@")).toBe(false);
    expect(isBranchName("@{-1}")).toBe(false);
  });

  test("a name that begins with a dash is refused whatever follows it", () => {
    for (const name of ["-x", "--x", "-", "--output=/tmp/x", "-O/tmp/o", "-é"]) {
      expect(isBranchName(name)).toBe(false);
    }
  });

  test("names with accents and emoji are fine, and a very long one is too", () => {
    expect(isBranchName("feature/ü-é")).toBe(true);
    expect(isBranchName("fix/🚀")).toBe(true);
    expect(isBranchName(`feature/${"x".repeat(200)}`)).toBe(true);
  });
});
