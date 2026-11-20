import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const PERSONA =
  "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)";
const HIDDEN =
  "runs a flightdeckd command whose noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

describe("risk rules: a flightdeckd verb the line hides from the reader (#3559)", () => {
  test("an escaped quote inside a flag's value does not swallow the verb behind it", () => {
    expect(
      wrongReasons([
        [String.raw`fd --project-path "a\" b" persona remove qa --scope host`, PERSONA],
        [String.raw`fd --project-path "x\"; touch /tmp/p #" persona remove qa`, PERSONA],
        [String.raw`flightdeckd --config "/x\"y/c.json" persona reset qa`, PERSONA],
        [String.raw`fd --project-path a\ b persona remove qa --scope host`, PERSONA],
        [String.raw`fd --project-path 'a\' persona remove qa --scope host`, PERSONA],
      ]),
    ).toEqual([]);
  });

  test("a noun or verb that is a variable, a glob or an ANSI-C quote is high, with a reason that says why", () => {
    expect(
      wrongReasons([
        ["V=remove; fd persona $V qa", HIDDEN],
        ["fd persona ${V} qa", HIDDEN],
        [String.raw`fd persona $'\x72emove' qa`, HIDDEN],
        ["fd persona rem[o]ve qa", HIDDEN],
        ["fd persona remov? qa", HIDDEN],
        ["fd persona {remove,list} qa", HIDDEN],
        ["fd $N remove qa", HIDDEN],
        ["fd persona {remove..list} qa", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("an argument past the verb may hold an expansion, and a word in quotes is a word", () => {
    expect(
      notHigh([
        "fd persona list --scope $SCOPE",
        'fd card list --project "$P"',
        "fd send fd-qa $MESSAGE",
        'fd persona show "$NAME"',
      ]),
    ).toEqual([]);
    expect(bash("fd persona show qa").reason).toBe(MEDIUM);
  });

  test("the compiled binaries and their Windows launchers are the CLI", () => {
    expect(
      wrongReasons([
        ["./flightdeckd-linux-x64 persona remove qa --scope host", PERSONA],
        ["dist/flightdeckd-linux-arm64 persona reset qa", PERSONA],
        ["flightdeckd-windows-x64.exe persona remove qa", PERSONA],
        ["flightdeckd.exe persona trust local --project-path /w", PERSONA],
        ["flightdeckd.cmd persona remove qa", PERSONA],
        ["fd.cmd persona remove qa", PERSONA],
        ["flightdeckd.ps1 persona remove qa", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("a program that only starts with the same letters is not the CLI", () => {
    expect(notHigh(["flightdeckd-notes persona remove qa", "fdisk persona remove qa"])).toEqual([]);
  });
});
