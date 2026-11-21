import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON = "answers a permission request (flightdeckd approve or deny)";

/**
 * Issue #3753: `fd vault watch` only reads what asks for a secret, so it stays an ordinary shell command.
 * `fd vault deny` answers a person's pending request, as `fd deny` does (#3425): a session that refuses
 * it from its own shell answers for them, so it is high, whatever way the CLI is reached. Approving,
 * delivering and saving rules that allow have no verb at all (docs/cli-parity.json: app only).
 */
describe("risk rules: the vault verbs of the CLI (#3753)", () => {
  test("watch is an ordinary shell command, however the CLI is reached", () => {
    expect(
      notHigh(["fd vault watch", "fd vault watch --json", "flightdeckd vault watch --json"]),
    ).toEqual([]);
  });

  test("deny answers a request like fd deny does: high, with options before the verb and through a shell", () => {
    expect(
      wrongReasons([
        ["fd vault deny q1", REASON],
        ["fd vault deny q1 --json", REASON],
        ["fd --json vault deny q1", REASON],
        ["flightdeckd --config /x/y.json vault deny q1", REASON],
        ["~/.flightdeck/bin/fd vault deny q1", REASON],
        ['fd "vault" "deny" q1', REASON],
        ["fd requests --json | head && fd vault deny q1", REASON],
        ["sh -c 'fd vault deny q1'", REASON],
        ["bun run apps/daemon/src/bin.ts vault deny q1", REASON],
      ]),
    ).toEqual([]);
  });

  test("a vault verb that only reads, or a secret named deny, is still ordinary", () => {
    expect(
      notHigh(["fd vault rules deny", "fd vault decisions deny", "fd vault report --days 3"]),
    ).toEqual([]);
  });
});
