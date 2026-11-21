import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "commits files of the checkout on a new branch (with the person's git hooks), pushes a branch to the remote and opens a pull request, or discards the changes of a file, none of which the app does without the person confirming it (flightdeckd changes commit, pr or revert)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session changing its own checkout through flightdeckd from its shell (#3620)", () => {
  test("changes commit, pr and revert are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd changes commit session:s1 --branch b --message m --digest a=d --confirm", REASON],
        ["fd changes pr session:s1 --title T --remote git@x:y.git --confirm", REASON],
        ["fd changes revert session:s1 src/a.ts --confirm", REASON],
        ["fd changes revert session:s1 src/a.ts", REASON],
        ["flightdeckd changes pr session:s1 --title T --remote r", REASON],
        ["fd --json changes commit session:s1 --branch b", REASON],
        ["flightdeckd --config /x/y.json changes revert session:s1 a.ts", REASON],
        ["bunx flightdeckd changes pr session:s1 --title T", REASON],
        ["bun run apps/daemon/src/bin.ts changes commit session:s1", REASON],
        ["FLIGHTDECK_X=1 fd changes revert session:s1 a.ts", REASON],
        ['fd changes "pr" session:s1 --title T', REASON],
        ["fd changes get session:s1 && fd changes pr session:s1 --title T", REASON],
        ['bash -c "fd changes commit session:s1 --branch b"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be any of them, so it is high", () => {
    expect(
      wrongReasons([
        ["fd changes $V session:s1", HIDDEN],
        ["bunx fd changes re[v]ert session:s1 a.ts", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads and undo-revert stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd changes get session:s1",
        "fd changes sessions /work/a.ts",
        "fd changes watch card:c1 --json",
        "fd changes undo-revert session:s1 a.ts --confirm",
        "fd changes --help",
        "fd card list --project pr",
        "echo changes revert",
        "git add changes",
        "ls changes/commit",
      ]),
    ).toEqual([]);
  });
});
