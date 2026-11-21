import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "links a project to a GitHub Project board, rewrites which board status is which column, pulls the board into the cards, or turns on pushing the cards' changes to it, none of which the app does without the person confirming it (flightdeckd boardsync link, set-map, sync-now or set-push --on)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session connecting a project to its board from its shell (#3540)", () => {
  test("boardsync link, set-map, sync-now and set-push --on are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd boardsync link api PVT_1", REASON],
        ["flightdeckd boardsync link api PVT_1 --map 'Todo=backlog'", REASON],
        ["fd boardsync set-map api --map Todo=done", REASON],
        ["fd boardsync sync-now api", REASON],
        ["fd boardsync set-push api --on --confirm", REASON],
        ["fd boardsync set-push api --on", REASON],
        ["fd --json boardsync link api PVT_1", REASON],
        ["flightdeckd --config /x/y.json boardsync sync-now api", REASON],
        ["bunx flightdeckd boardsync set-map api --map Todo=done", REASON],
        ["bun run apps/daemon/src/bin.ts boardsync link api PVT_1", REASON],
        ["FLIGHTDECK_X=1 fd boardsync sync-now api", REASON],
        ['fd boardsync "link" api PVT_1', REASON],
        ["fd boardsync status api && fd boardsync sync-now api", REASON],
        ['bash -c "fd boardsync link api PVT_1"', REASON],
      ]),
    ).toEqual([]);
  });

  test("set-push is high unless the only change it asks for is --off", () => {
    expect(
      wrongReasons([
        ["fd boardsync set-push api", REASON],
        ["fd boardsync set-push api --on --off", REASON],
        ["fd boardsync set-push api --off --confirm", REASON],
        ["fd boardsync set-push api --off $EXTRA", REASON],
        ["fd boardsync set-push api --off --on", REASON],
        ["fd boardsync set-push api --enable", REASON],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "fd boardsync set-push api --off",
        "fd --json boardsync set-push api --off",
        "fd boardsync set-push api --off --json",
        "fd boardsync set-push api --off --host pi",
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be any of them, so it is high", () => {
    expect(
      wrongReasons([
        ["fd boardsync $V api", HIDDEN],
        ["bunx fd boardsync rem[o]ve api", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the read verbs and unlink stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd boardsync boards",
        "fd boardsync status api",
        "fd boardsync log c1 --json",
        "fd boardsync unlink api",
        "fd boardsync --help",
        "fd card list --project link",
        "echo boardsync link",
        "git add boardsync",
        "ls boardsync/sync-now",
      ]),
    ).toEqual([]);
  });
});
