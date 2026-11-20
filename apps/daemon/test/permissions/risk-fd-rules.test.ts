import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON = "changes what guards the sessions (flightdeckd rules remove, autoapprove resume)";

describe("risk rules: a session removing a rule or resuming automatic approval from its shell (#3457)", () => {
  test("rules remove and autoapprove resume are high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd rules remove 'Bash(bun test:*)' --project api --confirm", REASON],
        ["flightdeckd --project api rules remove x --confirm", REASON],
        ["flightdeckd --config /x/y.json rules remove x --confirm --json", REASON],
        ["fd autoapprove resume --session s7 --confirm", REASON],
        ["flightdeckd --config=/x/y.json autoapprove resume --session s7", REASON],
        ["bun run apps/daemon/src/bin.ts rules remove x --confirm", REASON],
        ["~/.flightdeck/bin/fd autoapprove resume --session s1 --confirm", REASON],
        ["FLIGHTDECK_X=1 fd rules remove x --confirm", REASON],
        ['fd rules "remove" x --confirm', REASON],
        ["fd rules re''move x --confirm", REASON],
        ["fd rules list --json && fd rules remove x --confirm", REASON],
        ['bash -c "fd autoapprove resume --session s7 --confirm"', REASON],
        ["fd --limit 5 autoapprove resume --session s7 --confirm", REASON],
      ]),
    ).toEqual([]);
  });

  test("the list commands stay ordinary shell commands, and a word in an argument is not a verb", () => {
    expect(
      notHigh([
        "fd rules list --json",
        "fd rules list --project api",
        "fd autoapprove list --limit 5 --json",
        "fd autoapprove list --session s7",
        "fd send fd-qa 'please remove the rules'",
        "echo rules remove",
        "bun test autoapprove resume",
        "bash -c 'echo autoapprove resume'",
      ]),
    ).toEqual([]);
    expect(bash("fd rules list").reason).toBe(MEDIUM);
  });
});
