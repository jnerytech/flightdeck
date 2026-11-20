import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "moves or turns off the plan-quota guard that holds new cards back, so sessions can spend past the plan the person set (flightdeckd quota pause-at)";

describe("risk rules: a session moving the plan-quota guard from its shell (#3460)", () => {
  test("quota pause-at is high, however the CLI is reached and wherever its value flags sit", () => {
    expect(
      wrongReasons([
        ["fd quota pause-at off", REASON],
        ["flightdeckd quota pause-at 1", REASON],
        ["fd --json quota pause-at 0.9", REASON],
        ["flightdeckd --config /x/y.json quota pause-at off", REASON],
        ["bun run apps/daemon/src/bin.ts quota pause-at off", REASON],
        ["~/.flightdeck/bin/fd quota pause-at off", REASON],
        ["FLIGHTDECK_X=1 fd quota pause-at off", REASON],
        ['fd quota "pause-at" off', REASON],
        ["fd quota get && fd quota pause-at off", REASON],
        ['bash -c "fd quota pause-at off"', REASON],
        ["bunx flightdeckd quota pause-at off", REASON],
      ]),
    ).toEqual([]);
  });

  test("reading the quota or the usage stays an ordinary shell command, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd quota get --json",
        "fd quota history five_hour --hours 48",
        "fd usage --days 30",
        "echo quota pause-at off",
        "bun test quota pause-at",
        "bash -c 'echo quota pause-at off'",
      ]),
    ).toEqual([]);
    expect(bash("fd quota get").reason).toBe(MEDIUM);
  });
});
