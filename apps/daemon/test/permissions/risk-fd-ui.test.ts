import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "changes how the host presents itself to the person who uses its app, its default mode and the lock on it (flightdeckd ui set)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: ui set from a session's shell (#3781)", () => {
  test("ui set is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd ui set --mode simple --confirm", REASON],
        ["flightdeckd --config /tmp/c.json ui set --lock --confirm", REASON],
        ["fd --json ui set --unlock --confirm", REASON],
        ["bunx flightdeckd ui set --mode full --confirm", REASON],
        ['fd ui "set" --lock --confirm', REASON],
        ["fd sessions && fd ui set --lock --confirm", REASON],
        ['bash -c "fd ui set --lock --confirm"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be set, so it is high", () => {
    expect(
      wrongReasons([
        ["fd ui $V --lock --confirm", HIDDEN],
        ["bunx fd ui s[e]t --lock --confirm", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("a line that only names ui stays ordinary", () => {
    expect(notHigh(["echo ui set", "fd sessions --json"])).toEqual([]);
  });
});
