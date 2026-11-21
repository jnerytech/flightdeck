import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "trusts a project's run.yaml or runs its commands, without the person choosing it in the app (flightdeckd runenv trust or start)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session trusting or starting a run environment from its shell (#3621)", () => {
  test("runenv trust and start are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd runenv trust api --hash 9f3a1c --confirm", REASON],
        ["fd runenv start c1 --confirm", REASON],
        ["flightdeckd --host pi runenv start c1 --confirm --json", REASON],
        ["FLIGHTDECK_X=1 fd runenv trust api --hash h --confirm", REASON],
        ['fd "runenv" start c1 --confirm', REASON],
        ["fd runenv get c1 && fd runenv start c1 --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts runenv trust api --hash h --confirm", REASON],
        ["bash -c 'fd runenv start c1 --confirm'", REASON],
        ["sh -c 'flightdeckd runenv trust api --hash h --confirm'", REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands is high: the line does not say what it does", () => {
    expect(
      wrongReasons([
        ["A=start; fd runenv $A c1 --confirm", HIDDEN],
        ["fd runenv ${A} c1 --confirm", HIDDEN],
        ["fd runenv st{art,op} c1 --confirm", HIDDEN],
        ["bash -c 'fd runenv $A c1 --confirm'", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("the reads, stop and a word in an argument stay ordinary shell commands", () => {
    expect(
      notHigh([
        "fd runenv config api",
        "fd runenv get c1 --json --host pi",
        "fd runenv watch",
        "fd runenv stop c1",
        "fd send fd-qa 'runenv start c1'",
        "echo runenv trust api",
      ]),
    ).toEqual([]);
  });
});
