import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "saves, trusts or removes an action: a saved action is trusted as it is saved and then runs with its secrets, and a trusted one may run, without the person choosing it in the app (flightdeckd action save, trust or remove)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session saving, trusting or removing an action from its shell (#3629)", () => {
  test("action save, trust and remove are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd action save --definition-file d.json", REASON],
        ["fd action trust deploy --hash abc", REASON],
        ["fd action remove deploy", REASON],
        ["flightdeckd --host pi action remove deploy --json", REASON],
        ["FLIGHTDECK_X=1 fd action save --project api --definition-file d.json", REASON],
        ['fd "action" trust deploy --hash abc', REASON],
        ["fd action list --json && fd action remove deploy", REASON],
        ["bun run apps/daemon/src/bin.ts action save --definition-file d.json", REASON],
        ["bash -c 'fd action trust deploy --hash abc'", REASON],
        ["sh -c 'flightdeckd action remove deploy'", REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands is high: the line does not say what it does", () => {
    expect(
      wrongReasons([
        ["A=remove; fd action $A deploy", HIDDEN],
        ["fd action ${A} deploy", HIDDEN],
        ["fd action tru{st,x} deploy --hash abc", HIDDEN],
        ["bash -c 'fd action $A deploy'", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads, run and a word in an argument stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd action list",
        "fd action list --json --project api",
        "fd action list --plain --host pi",
        "fd action runs deploy --limit 20 --json",
        "fd action run deploy",
        "fd send fd-qa 'action remove deploy'",
        "echo action save",
      ]),
    ).toEqual([]);
  });
});
