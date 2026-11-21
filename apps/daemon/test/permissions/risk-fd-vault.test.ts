import { describe, expect, test } from "bun:test";
import { notHigh } from "../support/permissions-risk-rules.ts";

/**
 * Issue #3753: `fd vault watch` reads what asks for a secret, and `fd vault deny` only refuses a request, so
 * neither lifts a gate: they stay ordinary shell commands. Approving, delivering and saving rules that allow
 * have no verb at all (docs/cli-parity.json: app only), so a session has no way to use one of them from here.
 */
describe("risk rules: the vault verbs of the CLI that only read or refuse (#3753)", () => {
  test("watch and deny are ordinary, however the CLI is reached", () => {
    expect(
      notHigh([
        "fd vault watch",
        "fd vault watch --json",
        "flightdeckd vault watch --json",
        "fd vault deny q1",
        "fd vault deny q1 --json",
        "fd --json vault deny q1",
      ]),
    ).toEqual([]);
  });
});
