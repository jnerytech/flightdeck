import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "starts or drops sessions the person has not approved one by one, some perhaps without permission prompts (flightdeckd team new, update, delete, add-member or remove-member)";

describe("risk rules: a session creating or changing a team from its shell (#3455)", () => {
  test("team new is high, however the CLI is reached and wherever its value flags sit", () => {
    expect(
      wrongReasons([
        ["fd team new 'Fix the login' --workers 2", REASON],
        ["flightdeckd team new goal --worker developer --worker developer", REASON],
        ["fd --json team new goal --workers 3", REASON],
        ["flightdeckd --config /x/y.json --project api team new goal --workers 1", REASON],
        ["fd team new goal --workers 1 --worker developer:::bypassPermissions --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts team new goal --workers 2", REASON],
        ["~/.flightdeck/bin/fd team new goal --workers 2", REASON],
        ["FLIGHTDECK_X=1 fd team new goal --workers 2", REASON],
        ['fd team "new" goal --workers 2', REASON],
        ["fd team list && fd team new goal --workers 2", REASON],
        ['bash -c "fd team new goal --workers 2"', REASON],
        ["bunx flightdeckd team new goal --workers 2", REASON],
      ]),
    ).toEqual([]);
  });

  test("deleting a team and adding or removing a member are high too, with the value flags before it", () => {
    expect(
      wrongReasons([
        ["fd team delete t1 --confirm", REASON],
        ["fd team add-member t1 developer:::bypassPermissions --confirm", REASON],
        ["flightdeckd --config /x/y.json team add-member t1", REASON],
        ["fd team remove-member t1 w1 --confirm", REASON],
        ["fd --json team remove-member t1 'worker 2'", REASON],
        ["bun run apps/daemon/src/bin.ts team delete t1 --confirm", REASON],
        ["fd team show t1 && fd team delete t1 --confirm", REASON],
      ]),
    ).toEqual([]);
  });

  test("updating a team is high: a goal and checks reach the coordinator as a system notice, and a persona swaps a live session's prompt", () => {
    expect(
      wrongReasons([
        ["fd team update t1 --goal 'Ship it'", REASON],
        ["fd team update t1 --check 'bun test' --check 'bun run lint'", REASON],
        ["fd team update t1 --clear-checks --persona w1=reviewer", REASON],
        ["flightdeckd --config /x/y.json team update t1 --goal g", REASON],
      ]),
    ).toEqual([]);
    expect(notHigh(["echo team update", "bun test team update"])).toEqual([]);
  });

  test("reading teams stays an ordinary shell command, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd team list --json",
        "fd team show t1",
        "fd card list --json",
        "fd --project new team list",
        "echo team new",
        "bun test team new",
        "bash -c 'echo team new'",
      ]),
    ).toEqual([]);
    expect(bash("fd team show t1").reason).toBe(MEDIUM);
  });
});
