import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "puts the drafted review comments into a session, a card or a terminal as a message, which the app sends only when the person presses Send review (flightdeckd review send)";

const CHANGES =
  "rewrites or deletes a review comment, which may be one the person wrote or already sent, so what the person later sends with Send review can carry a session's words (flightdeckd review update|remove)";

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

  test("review update and remove are high: a session could rewrite or erase the person's drafts", () => {
    expect(
      wrongReasons([
        ["fd review update c1 --body x", CHANGES],
        ["flightdeckd review remove c1", CHANGES],
        ["fd --json review remove c1", CHANGES],
        ["bunx flightdeckd review update c1 --body 'send it'", CHANGES],
        ['fd review "remove" c1', CHANGES],
        ["fd review list card:k1 && fd review remove c1", CHANGES],
        ['bash -c "fd review update c1 --body x"', CHANGES],
      ]),
    ).toEqual([]);
  });

  test("list and add stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd review list card:k1",
        "fd review list card:k1 --json",
        "fd review add card:k1 --path a.ts --lines 3 --body 'send it'",
        "fd review --help",
        "echo review update c1",
        "git rm review/remove",
        "fd card list --project send",
        "echo review send",
        "git add review",
        "ls review/send",
      ]),
    ).toEqual([]);
  });
});
