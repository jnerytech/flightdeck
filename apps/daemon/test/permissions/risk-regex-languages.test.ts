import { describe, expect, test } from "bun:test";
import { repoFolder } from "../../src/central/domain/claude-launch-args.ts";
import { wrongReasons } from "../support/permissions-risk-rules.ts";

const PERSONA =
  "changes what the app asks a person to confirm (flightdeckd persona save, remove, reset, trust or publish-agent)";

describe("risk: the flag that hands a shell text to run keeps its language (#3524)", () => {
  test("a dash, letters with a c in them, or /c, in any case, makes the text a command line", () => {
    expect(
      wrongReasons([
        ["sh -c 'fd persona remove qa'", PERSONA],
        ["bash -lc 'fd persona remove qa'", PERSONA],
        ["bash -ilcx 'fd persona remove qa'", PERSONA],
        ["pwsh -Command 'fd persona remove qa'", PERSONA],
        ["pwsh -C 'fd persona remove qa'", PERSONA],
        ["cmd /c 'fd persona remove qa'", PERSONA],
        ["cmd /C 'fd persona remove qa'", PERSONA],
      ]),
    ).toEqual([]);
  });
});

describe("risk: the opening of a subshell is stripped from a word whatever its length (#3524)", () => {
  test("every opening form still shows the program behind it", () => {
    expect(
      wrongReasons([
        ["cat <(fd persona remove qa)", PERSONA],
        ["tee >(fd persona remove qa)", PERSONA],
        ["( fd persona remove qa )", PERSONA],
        ["(fd persona remove qa)", PERSONA],
        ["{ fd persona remove qa; }", PERSONA],
      ]),
    ).toEqual([]);
  });
});

describe("session name: the folder a session is named after loses only the trailing separators (#3524)", () => {
  test.each([
    ["/home/me/notes", null, "notes"],
    ["/home/me/notes/", null, "notes"],
    ["/home/me/notes///", null, "notes"],
    ["/home/me/notes\\/\\/", null, "notes"],
    ["C:\\work\\proj\\", null, "proj"],
    ["/x", "/work/repo/", "repo"],
    ["/", null, ""],
    ["////", null, ""],
    ["", null, ""],
    ["a//b", null, "b"],
  ])("%j with toplevel %j is named %j", (cwd, toplevel, name) => {
    expect(repoFolder(cwd, toplevel)).toBe(name);
  });

  test("a very long run of separators with no folder behind it is still answered at once", () => {
    const started = performance.now();
    expect(repoFolder(`a${"/".repeat(30_000)}b`, null)).toBe("b");
    expect(repoFolder("/".repeat(30_000), null)).toBe("");
    // timing: a linear trim takes milliseconds; a quadratic one takes seconds
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
