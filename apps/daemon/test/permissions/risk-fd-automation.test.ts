import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "saves, turns on or removes an automation of a project, which then fires on its own without the person choosing it in the app (flightdeckd automation save, enable or remove)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session saving, enabling or removing an automation from its shell (#3627)", () => {
  test("automation save, enable and remove are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd automation save api --name N --definition-file d.json", REASON],
        ["fd automation enable a1 --confirm", REASON],
        ["fd automation remove a1 --confirm", REASON],
        ["flightdeckd --host pi automation enable a1 --confirm --json", REASON],
        ["FLIGHTDECK_X=1 fd automation save api --name N --definition-file d.json", REASON],
        ['fd "automation" enable a1 --confirm', REASON],
        ["fd automation list api && fd automation remove a1 --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts automation enable a1 --confirm", REASON],
        ["bash -c 'fd automation enable a1 --confirm'", REASON],
        ["sh -c 'flightdeckd automation remove a1 --confirm'", REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands is high: the line does not say what it does", () => {
    expect(
      wrongReasons([
        ["A=enable; fd automation $A a1 --confirm", HIDDEN],
        ["fd automation ${A} a1 --confirm", HIDDEN],
        ["fd automation en{able,x} a1 --confirm", HIDDEN],
        ["bash -c 'fd automation $A a1 --confirm'", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads, disable and a word in an argument stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd automation list api",
        "fd automation runs a1 --limit 20 --json --host pi",
        "fd automation disable a1",
        "fd send fd-qa 'automation enable a1'",
        "echo automation remove a1",
      ]),
    ).toEqual([]);
  });
});
