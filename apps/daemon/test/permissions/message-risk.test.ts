import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

describe("risk: a session rewriting the message rules from its shell (issue #3622)", () => {
  const REASON =
    "rewrites the rules that decide which sessions may message each other, and frees paused pairs, without the person in the app; a typed --confirm is not the person (flightdeckd message rules-set)";
  const HIDDEN =
    "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

  test("message rules-set is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd message rules-set --policy-file p.json --confirm", REASON],
        ["flightdeckd message rules-set --policy-file - --unpause a|b --confirm", REASON],
        ["fd --json message rules-set --policy-file p.json --confirm", REASON],
        ["fd --host pi message rules-set --policy-file p.json --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts message rules-set --policy-file p.json", REASON],
        ['fd message "rules-set" --policy-file p.json --confirm', REASON],
        ["fd message rules --json && fd message rules-set --policy-file p.json --confirm", REASON],
        ['bash -c "fd message rules-set --policy-file p.json --confirm"', REASON],
        ["bunx flightdeckd message rules-set --policy-file p.json --confirm", REASON],
        [
          "bun run apps/daemon/src/bin.ts message --host h rules-set --policy-file p --confirm",
          REASON,
        ],
        ["bun run apps/daemon/src/bin.ts message --json rules-set --policy-file p", REASON],
        ["bunx flightdeckd message --config c.json rules-set --policy-file p --confirm", REASON],
      ]),
    ).toEqual([]);
  });

  test("the reads, a managed session's own message verbs and a word in an argument stay ordinary", () => {
    expect(
      notHigh([
        "fd message rules",
        "fd --json message rules",
        "fd message history --team t1",
        "fd message watch",
        "fd message list",
        "fd message read s-dev --last 3",
        "echo message rules-set",
        "git message rules-set",
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands is high with the reason that says why", () => {
    expect(
      wrongReasons([
        ["V=rules-set; fd message $V --policy-file p.json --confirm", HIDDEN],
        ["fd message rules-* --policy-file p.json", HIDDEN],
        ["bash -c 'fd message $V'", HIDDEN],
        ["fd message $V", HIDDEN],
      ]),
    ).toEqual([]);
  });
});
