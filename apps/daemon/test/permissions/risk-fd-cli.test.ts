import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON = "answers a permission request (flightdeckd approve or deny)";

describe("risk rules: a session answering a permission request from its shell (#3425)", () => {
  test("approve and deny are high, under either name, with options before the verb and any path", () => {
    expect(
      wrongReasons([
        ["fd approve r1", REASON],
        ["fd approve r1 --hold", REASON],
        ["fd deny r1", REASON],
        ["flightdeckd approve r1 --hold --json", REASON],
        ["flightdeckd --config /x/y.json deny r1", REASON],
        ["flightdeckd --config=/x/y.json approve r1", REASON],
        ["~/.flightdeck/bin/fd approve r1", REASON],
        ["/home/u/.flightdeck/bin/flightdeckd.exe approve r1", REASON],
        ["FLIGHTDECK_X=1 fd approve r1", REASON],
        ["fd requests --json | head && fd approve r1", REASON],
        ['fd "approve" r1 --hold', REASON],
        ["flightdeckd 'deny' r1", REASON],
        ['fd appr""ove r1', REASON],
        ["fd app\\rove r1", REASON],
        ["bun run apps/daemon/src/bin.ts approve r1 --hold", REASON],
        ["bunx flightdeckd approve r1", REASON],
        ['bash -c "fd approve r1 --hold"', REASON],
        ["sh -c 'flightdeckd deny r1'", REASON],
      ]),
    ).toEqual([]);
  });

  test("the other commands stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd requests",
        "fd send fd-qa hello",
        "fd host --json",
        "fd sessions",
        "flightdeckd doctor",
        'fd send fd-qa "please approve r1"',
        "echo approve",
        "approve r1",
        "bun test approve",
        "bash -c 'echo approve'",
      ]),
    ).toEqual([]);
    expect(bash("fd requests").reason).toBe(MEDIUM);
  });
});
