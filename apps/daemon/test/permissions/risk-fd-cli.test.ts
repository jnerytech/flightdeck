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
      ]),
    ).toEqual([]);
    expect(bash("fd requests").reason).toBe(MEDIUM);
  });
});
