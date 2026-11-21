import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "puts the drafted review comments into a session, a card or a terminal as a message, which the app sends only when the person presses Send review (flightdeckd review send)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a session sending a review from its shell (#3619)", () => {
  test("review send is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd review send card:k1 --confirm", REASON],
        ["flightdeckd review send session:s1 --confirm", REASON],
        ["fd review send card:k1", REASON],
        ["fd --json review send card:k1 --confirm", REASON],
        ["flightdeckd --config /x/y.json review send card:k1 --language pt-BR --confirm", REASON],
        ["bunx flightdeckd review send card:k1 --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts review send card:k1 --confirm", REASON],
        ["FLIGHTDECK_X=1 fd review send card:k1 --confirm", REASON],
        ['fd review "send" card:k1 --confirm', REASON],
        ["fd review list card:k1 && fd review send card:k1 --confirm", REASON],
        ['bash -c "fd review send card:k1 --confirm"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be send, so it is high", () => {
    expect(
      wrongReasons([
        ["fd review $V card:k1", HIDDEN],
        ["bunx fd review se[n]d card:k1", HIDDEN],
        ["fd review $(echo send) card:k1 --confirm", "substituição de comando"],
      ]),
    ).toEqual([]);
  });

  test("list, add, update and remove stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd review list card:k1",
        "fd review list card:k1 --json",
        "fd review add card:k1 --path a.ts --lines 3 --body 'send it'",
        "fd review update c1 --body x",
        "fd review remove c1",
        "fd review --help",
        "fd card list --project send",
        "echo review send",
        "git add review",
        "ls review/send",
      ]),
    ).toEqual([]);
  });
});
