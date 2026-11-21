import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "puts text into a terminal session as the person's next prompt, with no sender, no message rules and no loop guard (flightdeckd external message)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: external sessions and names from a session's shell (#3735)", () => {
  test("external message is high, however the CLI is reached: it is a prompt the person did not type", () => {
    expect(
      wrongReasons([
        ["fd external message ext-1 --text 'go on'", REASON],
        ["flightdeckd --host pi external message ext-1 --text hello", REASON],
        ["flightdeckd fd external message ext-1 --text hi", REASON],
        ["fd --json external message ext-1 --text hi", REASON],
        ["bunx flightdeckd external message ext-1 --text hi", REASON],
        ['fd external "message" ext-1 --text hi', REASON],
        ["fd external list && fd external message ext-1 --text hi", REASON],
        ['bash -c "fd external message ext-1 --text hi"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be message, so it is high", () => {
    expect(
      wrongReasons([
        ["fd external $V ext-1 --text hi", HIDDEN],
        ["bunx fd external me[s]sage ext-1 --text hi", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("external list and watch and names list read only, so they stay ordinary", () => {
    expect(
      notHigh([
        "fd external list",
        "fd external list --json",
        "fd external watch --json",
        "fd names list",
        "fd names list --json --host pi",
      ]),
    ).toEqual([]);
  });
});
