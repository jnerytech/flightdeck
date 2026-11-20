import { describe, expect, test } from "bun:test";
import { bash, MEDIUM, notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const PERSONA =
  "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)";
const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

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

  test("a backslash before two blanks ends the word, so the verb after it is still read", () => {
    expect(
      wrongReasons([
        [String.raw`fd --prompt \  persona remove qa`, PERSONA],
        [String.raw`fd --project-path a\  persona remove qa`, PERSONA],
        ["fd --prompt \\\t persona remove qa", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("an ANSI-C quote keeps an escaped quote inside, and an escaped quote in an assignment is no quote", () => {
    expect(
      wrongReasons([
        [String.raw`fd --project-path $'\'' persona remove qa`, PERSONA],
        [String.raw`fd --prompt $'a\';b' persona remove qa`, PERSONA],
        [String.raw`X=a\"b fd --prompt "x" persona remove qa`, PERSONA],
        [String.raw`FOO=\" fd --prompt "x" persona remove qa`, PERSONA],
      ]),
    ).toEqual([]);
  });

  test("a program name the shell expands to the CLI is high, with a reason that says why", () => {
    expect(
      wrongReasons([
        ["fd${IFS}persona${IFS}remove${IFS}qa", HIDDEN],
        ["{fd,persona,remove,qa}", HIDDEN],
        ["f{d,d} persona remove qa", HIDDEN],
        ["/path/bin/f[d] persona remove qa", HIDDEN],
        ["./dist/flightdeckd-linux-x6? persona remove qa", HIDDEN],
        ["fl*htdeckd persona remove qa", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("PowerShell reads a backslash as a path separator and a backtick as the escape", () => {
    expect(
      wrongReasons(
        [
          [String.raw`fd --project-path "C:\work\" persona remove qa`, PERSONA],
          ['fd --project-path "a`" b" persona remove qa', PERSONA],
        ],
        "PowerShell",
      ),
    ).toEqual([]);
  });

  test("an argument past the verb may hold an expansion, and a word in quotes is a word", () => {
    expect(
      notHigh([
        "fd persona list --scope $SCOPE",
        'fd card list --project "$P"',
        "fd send fd-qa $MESSAGE",
        'fd persona show "$NAME"',
        "fd send $SID hello",
        "fd open ../repo",
        "fd status *",
        'fd say "hello, world"',
        "$EDITOR $FILE",
        "$CC $FLAGS main.c",
        "python$V script.py",
        "ls f*",
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
