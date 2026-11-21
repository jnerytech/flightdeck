import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";
const REMOVE =
  "deletes the folder of a worktree and the branch it was on, work the person did not look at again in the app; a typed --confirm is not the person (flightdeckd worktree remove)";

describe("risk rules: a session deleting worktree folders from its shell (#3702)", () => {
  test("worktree remove is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd worktree remove api /w/api/k1 --confirm", REMOVE],
        ["flightdeckd worktree remove api /w/a /w/b --confirm", REMOVE],
        ["fd --json worktree remove api /w/a", REMOVE],
        ["flightdeckd --config /x/y.json worktree remove api /w/a", REMOVE],
        ["bun run apps/daemon/src/bin.ts worktree remove api /w/a", REMOVE],
        ["FLIGHTDECK_X=1 fd worktree remove api /w/a --confirm", REMOVE],
        ['fd worktree "remove" api /w/a', REMOVE],
        ["fd worktree list && fd worktree remove api /w/a --confirm", REMOVE],
        ['bash -c "fd worktree remove api /w/a --confirm"', REMOVE],
        ["bunx flightdeckd worktree remove api /w/a", REMOVE],
      ]),
    ).toEqual([]);
  });

  test("worktree list, issues list, get and create-card, and card pr-comments and pr-comments-send stay ordinary, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd worktree list",
        "fd worktree list api --json",
        "fd issues list api",
        "fd issues get api 7",
        "fd issues create-card api github:acme/api#7",
        "fd card pr-comments k1",
        "fd card pr-comments-send k1 c1",
        "fd worktree --help",
        "echo worktree remove",
        "git worktree list",
        "ls worktree/remove",
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands, or an xargs line with no verb, is high with the reason that says why", () => {
    expect(
      wrongReasons([
        ["V=remove; fd worktree $V api /w/a --confirm", HIDDEN],
        ["fd worktree rem* api", HIDDEN],
        ["fd worktree {remove,list} api", HIDDEN],
        [String.raw`fd worktree $'rem\x6fve' api /w/a`, HIDDEN],
        ["echo remove api /w/a --confirm | xargs fd worktree", HIDDEN],
      ]),
    ).toEqual([]);
  });
});
