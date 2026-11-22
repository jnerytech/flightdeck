import { describe, expect, test } from "bun:test";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const REASON =
  "moves a session, its transcript and its code, to another host, and archives it on this one (flightdeckd session teleport)";

const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: session teleport from a session's shell (#3704)", () => {
  test("session teleport is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd session teleport api --to pi --repo /srv/api --confirm", REASON],
        ["flightdeckd --host pi session teleport api --to cloud --repo /r --confirm", REASON],
        ["fd --json session teleport api --to pi --repo /r", REASON],
        ["bunx flightdeckd session teleport api --to pi --repo /r --confirm", REASON],
        ['fd session "teleport" api --to pi --repo /r --confirm', REASON],
        ["fd sessions && fd session teleport api --to pi --repo /r --confirm", REASON],
        ['bash -c "fd session teleport api --to pi --repo /r --confirm"', REASON],
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands could be teleport, so it is high", () => {
    expect(
      wrongReasons([
        ["fd session $V api --to pi --repo /r --confirm", HIDDEN],
        ["bunx fd session tele[p]ort api --to pi --repo /r --confirm", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("a line that only says it, and the other session reads, stay ordinary", () => {
    expect(
      notHigh([
        "echo session teleport api",
        "fd session summary api --json",
        "fd session files api",
        "fd session interrupted",
      ]),
    ).toEqual([]);
  });
});
