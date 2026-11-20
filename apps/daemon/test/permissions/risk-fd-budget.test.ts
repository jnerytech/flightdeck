import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "raises, moves or drops a cost limit that holds new cards back, so sessions can spend past what the person set (flightdeckd budget set, set-quota or remove)";

describe("risk rules: a session changing a cost limit from its shell (#3460)", () => {
  test("budget set, set-quota and remove are high, however the CLI is reached and wherever its value flags sit", () => {
    expect(
      wrongReasons([
        ["fd budget set --scope host --period day --limit-usd 500 --action notify", REASON],
        [
          "flightdeckd budget set-quota --scope host --window five_hour --limit-pct 1 --action notify",
          REASON,
        ],
        ["fd budget remove b1", REASON],
        ["fd --json budget remove b1", REASON],
        ["flightdeckd --config /x/y.json budget remove b1", REASON],
        [
          "fd budget set --scope project --project p --period month --limit-usd 9 --action queue",
          REASON,
        ],
        ["bun run apps/daemon/src/bin.ts budget remove b1", REASON],
        ["~/.flightdeck/bin/fd budget remove b1", REASON],
        ['fd budget "remove" b1', REASON],
        ["fd budget list && fd budget remove b1", REASON],
        ['bash -c "fd budget remove b1"', REASON],
      ]),
    ).toEqual([]);
  });

  test("listing the budgets stays an ordinary shell command, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd budget list --json",
        "echo budget remove b1",
        "bun test budget remove",
        "bash -c 'echo budget set --scope host'",
      ]),
    ).toEqual([]);
    expect(bash("fd budget list").reason).toBe(MEDIUM);
  });
});
