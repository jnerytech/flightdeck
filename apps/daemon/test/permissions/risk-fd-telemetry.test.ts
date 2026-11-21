import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";
const REASON =
  "changes the Claude Code settings of the person's account: `telemetry install` writes the exporter keys into ~/.claude/settings.json and `telemetry uninstall` takes them out and rotates the receiver token, so every Claude session of the account starts or stops sending its timing to the daemon (flightdeckd telemetry install or uninstall)";

describe("risk rules: a session changing the telemetry opt-in through flightdeckd from its shell (#3755)", () => {
  test("telemetry install and uninstall are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd telemetry install", REASON],
        ["fd telemetry uninstall", REASON],
        ["flightdeckd --config /x/y.json telemetry install", REASON],
        ["bunx flightdeckd telemetry uninstall", REASON],
        ["bun run apps/daemon/src/bin.ts telemetry install", REASON],
        ["FLIGHTDECK_X=1 fd telemetry install", REASON],
        ['fd telemetry "install"', REASON],
        ["fd telemetry status && fd telemetry install", REASON],
        ['bash -c "fd telemetry uninstall"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be install, so it is high", () => {
    expect(wrongReasons([["fd telemetry $V", HIDDEN]])).toEqual([]);
  });

  test("status, session and summary read, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd telemetry status",
        "fd telemetry session abc-123 --json",
        "fd telemetry summary --host pi",
        "fd costs sessions a1 b2 --json",
        "echo telemetry install",
        "git add telemetry",
      ]),
    ).toEqual([]);
  });
});
