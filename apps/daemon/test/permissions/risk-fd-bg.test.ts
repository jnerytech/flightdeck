import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";
const REASON =
  "starts, stops, restarts or writes into a background session of the host: `bg start` runs a new Claude with a prompt the person did not read in the app, `bg message` can resume a stopped session with any text, which is `bg start` by another route, and `bg stop` and `bg respawn` end or replace a session that may be mid-work (flightdeckd bg start, stop, respawn or message)";

describe("risk rules: a session controlling background sessions through flightdeckd from its shell (#3734)", () => {
  test("bg start, stop, respawn and message are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd bg start --cwd /w --prompt x", REASON],
        ["fd bg start --card c1", REASON],
        ["fd bg stop ab12", REASON],
        ["fd bg respawn ab12", REASON],
        ["fd bg message ab12 --text hi", REASON],
        ["flightdeckd --host pi bg start --card c1", REASON],
        ["fd --json bg stop ab12", REASON],
        ["flightdeckd --config /x/y.json bg message ab12 --text hi", REASON],
        ["bunx flightdeckd bg respawn ab12", REASON],
        ["bun run apps/daemon/src/bin.ts bg stop ab12", REASON],
        ["FLIGHTDECK_X=1 fd bg stop ab12", REASON],
        ['fd bg "stop" ab12', REASON],
        ["fd bg list && fd bg stop ab12", REASON],
        ['bash -c "fd bg start --card c1"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be any of them, so it is high", () => {
    expect(
      wrongReasons([
        ["fd bg $V ab12", HIDDEN],
        ["bunx fd bg st[o]p ab12", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("bg list stays an ordinary shell command, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd bg list",
        "fd bg list --json --host pi",
        "fd bg --help",
        "echo bg stop",
        "git add bg",
        "ls bg/start",
      ]),
    ).toEqual([]);
  });
});
