import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "reads the daemon's own log, which holds paths and whatever the redaction missed, so a session could read what it was never given (flightdeckd logs tail)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: the daemon's log from a session's shell (#3736)", () => {
  test("logs tail is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd logs tail", REASON],
        ["fd logs tail --lines 500 --json", REASON],
        ["flightdeckd --host pi logs tail", REASON],
        ["flightdeckd fd logs tail", REASON],
        ["bunx flightdeckd logs tail", REASON],
        ['fd logs "tail"', REASON],
        ["fd releases list && fd logs tail", REASON],
        ['bash -c "fd logs tail"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be tail, so it is high", () => {
    expect(
      wrongReasons([
        ["fd logs $V", HIDDEN],
        ["bunx fd logs ta[i]l", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("releases list, alert list and activity since read what the app shows, so they stay ordinary", () => {
    expect(
      notHigh([
        "fd releases list",
        "fd releases list --limit 5 --json",
        "fd alert list api",
        "fd alert list api --json --host pi",
        "fd activity since 2026-11-20T00:00:00Z",
        "fd activity since 2026-11-20T00:00:00Z --limit 10 --json",
      ]),
    ).toEqual([]);
  });
});
