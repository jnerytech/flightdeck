import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

const PERSONA =
  "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)";
const HISTORY =
  "does what the app asks a person to confirm (flightdeckd history resume --force, or with a permission mode)";
const HIDDEN =
  "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

/**
 * Spellings of a `fd` line that real bash runs as the verb and that the rules read as an ordinary
 * command (#3570). Each row was run through bash with a fake `fd` that logs its arguments.
 */
describe("risk rules: spellings of a flightdeckd line that the shell reads another way (#3570)", () => {
  test("a redirection before the program does not cut the line at its `&`", () => {
    expect(
      wrongReasons([
        ["2>&1 fd persona remove qa", PERSONA],
        [">/dev/null 2>&1 fd persona remove qa", PERSONA],
        ["fd persona remove qa 2>&1", PERSONA],
        ["sleep 1 & fd persona remove qa", PERSONA],
        ["fd persona remove qa &>/dev/null", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("a prefix assignment that appends, or whose value holds an escaped blank, is no part of the command", () => {
    expect(
      wrongReasons([
        ["A+=x fd persona remove qa", PERSONA],
        [String.raw`A=x\ y fd persona remove qa`, PERSONA],
        [String.raw`A=x\ y\ z B+=1 fd persona remove qa`, PERSONA],
        ["A='x y' fd persona remove qa", PERSONA],
        ["env A+=x fd persona remove qa", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("blanks after a backslash are counted one by one: one escapes, the next ends the word", () => {
    expect(
      wrongReasons([
        [String.raw`fd --message a\ b\  persona remove qa`, PERSONA],
        [String.raw`fd --message a\ \  persona remove qa`, PERSONA],
      ]),
    ).toEqual([]);
  });

  test("a brace range that opens the program word is a range, and a bare brace is still a group", () => {
    expect(
      wrongReasons([
        ["{f..f}d persona remove qa", HIDDEN],
        ["{fd,fd} persona remove qa", HIDDEN],
        ["{ fd persona remove qa; }", PERSONA],
        ["{ fd persona remove qa\n}", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("a flag that comes from a variable may be the one that raises a resume", () => {
    expect(
      wrongReasons([
        ["F=--force; fd history resume s $F", HISTORY],
        ['fd history resume s "$F"', HISTORY],
        ["fd history resume s ${F}", HISTORY],
        ["fd history resume s $'--force'", HISTORY],
        ["fd history resume s --f*", HISTORY],
      ]),
    ).toEqual([]);
    expect(
      notHigh(["fd history resume abc", "fd history list $FLAGS", "fd history show $ID"]),
    ).toEqual([]);
  });

  test("a runner started with the CLI and a noun the shell expands is high, as the CLI itself is", () => {
    expect(
      wrongReasons([
        ["bun run start $V c1", HIDDEN],
        ["bun bin.ts $V c1", HIDDEN],
        ["bun run apps/daemon/src/bin.ts $V discard c1", HIDDEN],
        ["bunx fd $N remove qa", HIDDEN],
        ["npx fd ${N} remove qa", HIDDEN],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "bun build apps/daemon/src/bin.ts --outfile $OUT",
        "bun test apps/daemon/test/bin.ts $X",
        "bun run build $TARGET",
      ]),
    ).toEqual([]);
  });

  test("every noun a rule reads has its verb checked for an expansion", () => {
    // The rules live in risk.ts and in the files it takes a domain's rules from.
    const source = ["risk.ts", "project-risk.ts"]
      .map((file) =>
        readFileSync(new URL(`../../src/permissions/domain/${file}`, import.meta.url), "utf8"),
      )
      .join("\n");
    const nouns = new Set([
      ...[...source.matchAll(/runsCliVerb\(\s*prog,\s*args,\s*"([a-z-]+)"/g)].map(
        (m) => m[1] as string,
      ),
      ...[...source.matchAll(/(?<![.\w])command === "([a-z-]+)"/g)].map((m) => m[1] as string),
    ]);
    // The rules read at least these, so an empty set means the pattern above drifted from the source.
    expect([...nouns].sort()).toEqual(expect.arrayContaining(["persona", "project", "ssh"]));
    expect(wrongReasons([...nouns].map((noun) => [`fd ${noun} $V x`, HIDDEN]))).toEqual([]);
  });

  test("words that xargs appends to the line may be the noun or the verb", () => {
    expect(
      wrongReasons([
        ["echo persona remove qa | xargs fd", HIDDEN],
        ["echo remove qa | xargs fd persona", HIDDEN],
        ["echo persona remove qa | xargs -n 3 flightdeckd", HIDDEN],
        ["echo persona remove qa | xargs -r env fd", HIDDEN],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "echo qa | xargs fd persona show",
        "echo s1 | xargs fd send",
        "echo x | xargs echo fd",
        "echo f | xargs fd persona list",
      ]),
    ).toEqual([]);
  });

  test("a brace list that opens the program word expands to the CLI, whatever its alternatives and suffix", () => {
    expect(
      wrongReasons([
        ["{f,car}d delete c1", HIDDEN],
        ["{f,x}d persona remove qa", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("a group or a substitution in front of a brace range does not hide it", () => {
    expect(
      wrongReasons([
        ["({f..f}d persona remove qa)", HIDDEN],
        ["`{f..f}d persona remove qa`", HIDDEN],
        ["( {f..f}d persona remove qa )", HIDDEN],
      ]),
    ).toEqual([]);
  });

  test("an array element assigned in front of the program is no part of the command", () => {
    expect(
      wrongReasons([
        ["A[0]=x fd persona remove qa", PERSONA],
        ["A[$i]+=x fd persona remove qa", PERSONA],
      ]),
    ).toEqual([]);
  });

  test("xargs gives a runner the words it reads, and a resume the flag it reads", () => {
    expect(
      wrongReasons([
        ["echo persona remove qa | xargs bun bin.ts", HIDDEN],
        ["echo persona remove qa | xargs bun run start", HIDDEN],
        ["echo --force | xargs fd history resume s", HIDDEN],
        ["echo --force | xargs bun run start history resume s", HIDDEN],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "echo x | xargs bun run build",
        "echo qa | xargs bun run start persona show",
        "echo s | xargs fd history list",
      ]),
    ).toEqual([]);
  });
});
