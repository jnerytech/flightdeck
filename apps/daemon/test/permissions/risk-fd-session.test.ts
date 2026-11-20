import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "ends a session the person did not end, drops its queued messages and its open permission requests, and skips the team's guard on a coordinator (flightdeckd session close)";

const REASON_STARTS =
  "starts a session, or changes what a live one may do or the persona it follows, without the person confirming it in the app (flightdeckd session create, set-mode, fork or apply-persona)";

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
        "fd session clear-persona s1",
        "fd session clear-persona s1 --language en",
        "echo session close s1",
        "bun test session close",
        "bash -c 'echo session close s1'",
      ]),
    ).toEqual([]);
    expect(bash("fd session interrupt s1").reason).toBe(MEDIUM);
  });
});

describe("risk rules: a session started or reshaped from its shell (#3514)", () => {
  test("session create, fork, set-mode and apply-persona are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd session create --cwd /w --permission-mode bypassPermissions", REASON_STARTS],
        ["flightdeckd session create --cwd /w", REASON_STARTS],
        ["fd --json session create --cwd /w --prompt 'x'", REASON_STARTS],
        ["fd session fork c-1 --cwd /w --open terminal", REASON_STARTS],
        ["fd session set-mode s1 bypassPermissions", REASON_STARTS],
        ["fd session set-mode s1 plan --host pi", REASON_STARTS],
        ["fd session apply-persona s1 reviewer", REASON_STARTS],
        ["flightdeckd --config /x/y.json session apply-persona s1 reviewer", REASON_STARTS],
        ["bun run apps/daemon/src/bin.ts session create --cwd /w", REASON_STARTS],
        ["FLIGHTDECK_X=1 fd session set-mode s1 plan", REASON_STARTS],
        ['bash -c "fd session create --cwd /w"', REASON_STARTS],
        ["fd session summary s1 && fd session fork c-1 --cwd /w", REASON_STARTS],
      ]),
    ).toEqual([]);
  });

  test("a word in an argument is not a verb, and the verbs of another command are not these", () => {
    expect(
      notHigh([
        "echo session create",
        "bun test session fork",
        "bash -c 'echo session set-mode s1 plan'",
        "fd history create",
        "fd persona apply-persona x",
        "fd card create",
      ]),
    ).toEqual([]);
  });
});
