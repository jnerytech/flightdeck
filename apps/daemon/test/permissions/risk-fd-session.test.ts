import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "ends a session the person did not end, drops its queued messages and its open permission requests, and skips the team's guard on a coordinator (flightdeckd session close)";

describe("risk rules: a session ending another session from its shell (#3514)", () => {
  test("session close is high, however the CLI is reached and wherever its value flags sit", () => {
    expect(
      wrongReasons([
        ["fd session close fd-qa", REASON],
        ["flightdeckd session close s1", REASON],
        ["fd --json session close s1", REASON],
        ["flightdeckd --config /x/y.json session close s1", REASON],
        ["fd session close s1 --host pi", REASON],
        ["bun run apps/daemon/src/bin.ts session close s1", REASON],
        ["~/.flightdeck/bin/fd session close s1", REASON],
        ["FLIGHTDECK_X=1 fd session close s1", REASON],
        ['fd session "close" s1', REASON],
        ["fd session summary s1 && fd session close s1", REASON],
        ['bash -c "fd session close s1"', REASON],
        ["bunx flightdeckd session close s1", REASON],
      ]),
    ).toEqual([]);
  });

  test("the other session verbs stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd session interrupt s1",
        "fd session resume s1",
        "fd session sleep s1",
        "fd session set-model s1 opus",
        "fd session set-effort s1 high",
        "fd session meta set s1 pinned=true",
        "fd session summary s1 --json",
        "fd session files s1",
        "echo session close s1",
        "bun test session close",
        "bash -c 'echo session close s1'",
      ]),
    ).toEqual([]);
    expect(bash("fd session interrupt s1").reason).toBe(MEDIUM);
  });
});
