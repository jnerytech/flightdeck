import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  escapeRegExp,
  excludeArgs,
  excludePattern,
  onlyArgs,
  onlyPattern,
  QUARANTINE_FILE,
  type QuarantineEntry,
  readQuarantine,
  shardArgs,
} from "../lib/quarantine.ts";
import { realTempDir } from "./temp-dir.ts";

const entry = (test: string, file = "a.test.ts"): QuarantineEntry => ({
  file,
  test,
  issue: 288,
  reason: "wall-clock",
});

/** Titles with every character a regular expression gives a meaning to. */
const TITLES = [
  "lint barra @tauri-apps/* fora de src/platform/tauri",
  "the render time at 9,090 rows is within 2x of the time at 690 rows",
  "two files that patch HTMLElement.prototype and never restore it do not see each other's patch",
  "a [bracket], a (group), a|b, 1+1, ^start$, {n}, back\\slash?",
];

describe("quarantine: the required jobs leave out the listed tests and a non-blocking job runs them (issue #288)", () => {
  test("a title escaped as a pattern matches itself and nothing that only looks like it", () => {
    for (const title of TITLES) {
      expect(new RegExp(escapeRegExp(title)).test(`suite ${title}`)).toBe(true);
    }
    expect(new RegExp(escapeRegExp("a.c")).test("abc")).toBe(false);
    expect(new RegExp(escapeRegExp("a|b")).test("b")).toBe(false);
    expect(new RegExp(escapeRegExp("(x)")).test("x")).toBe(false);
  });

  test("the exclude pattern rejects each listed test, whatever suite holds it, and accepts the rest", () => {
    const pattern = new RegExp(excludePattern(TITLES.map((title) => entry(title))));
    for (const title of TITLES) {
      expect(pattern.test(title)).toBe(false);
      expect(pattern.test(`outer: the suite (x) ${title}`)).toBe(false);
    }
    expect(pattern.test("outer: the suite (x) keep this one")).toBe(true);
    expect(pattern.test("lint barra")).toBe(true);
  });

  test("the only pattern accepts each listed test, whatever suite holds it, and rejects the rest", () => {
    const pattern = new RegExp(onlyPattern(TITLES.map((title) => entry(title))));
    for (const title of TITLES) expect(pattern.test(`outer: the suite (x) ${title}`)).toBe(true);
    expect(pattern.test("outer: the suite (x) keep this one")).toBe(false);
  });

  test("an empty list leaves no pattern and no arguments, so nothing is filtered and nothing is run", () => {
    expect(excludePattern([])).toBe("");
    expect(onlyPattern([])).toBe("");
    expect(excludeArgs([])).toEqual([]);
    expect(onlyArgs([])).toEqual([]);
  });

  test("the arguments are the name flag with the pattern, and the only run adds each file once", () => {
    const entries = [
      entry("one", "x.test.ts"),
      entry("two", "x.test.ts"),
      entry("three", "y.test.ts"),
    ];
    expect(excludeArgs(entries)).toEqual(["--test-name-pattern", excludePattern(entries)]);
    expect(onlyArgs(entries)).toEqual([
      "--test-name-pattern",
      onlyPattern(entries),
      "x.test.ts",
      "y.test.ts",
    ]);
  });

  test("bun runs everything but the listed test with the exclude arguments, and only it with the only ones", async () => {
    const dir = realTempDir("fd-quarantine-");
    writeFileSync(
      join(dir, "q.test.ts"),
      [
        'import { describe, expect, test } from "bun:test";',
        'describe("outer: the suite (x)", () => {',
        '  test("keep this one", () => expect(1).toBe(1));',
        '  test("lint barra @tauri-apps/* fora de src/platform/tauri", () => expect(1).toBe(2));',
        "});",
      ].join("\n"),
    );
    const listed = [entry("lint barra @tauri-apps/* fora de src/platform/tauri", "q.test.ts")];
    const run = async (args: string[]) => {
      const proc = Bun.spawn([process.execPath, "test", ...args], {
        cwd: dir,
        env: { ...process.env, CLAUDECODE: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, log: `${out}${err}` };
    };
    const without = await run([...excludeArgs(listed), "q.test.ts"]);
    expect(without.log).toContain(" 1 pass");
    expect(without.log).toContain(" 0 fail");
    expect(without.code).toBe(0);
    const only = await run(onlyArgs(listed));
    expect(only.log).toContain(" 0 pass");
    expect(only.log).toContain(" 1 fail");
    expect(only.code).not.toBe(0);
  }, 60_000);

  test("a Windows shard runs with the area config, the timeout and its number, then leaves the listed tests out", () => {
    expect(shardArgs("win32", 2, [])).toEqual([
      "--config=bunfig.area.toml",
      "test",
      "--timeout=15000",
      "--shard=2/3",
    ]);
    const entries = [entry("one")];
    expect(shardArgs("win32", 1, entries)).toEqual([
      "--config=bunfig.area.toml",
      "test",
      "--timeout=15000",
      "--shard=1/3",
      ...excludeArgs(entries),
    ]);
  });

  test("a list that is not a list, or an entry without its fields, is refused naming the entry", () => {
    const read = (text: string) => {
      const root = realTempDir("fd-quarantine-list-");
      mkdirSync(dirname(join(root, QUARANTINE_FILE)), { recursive: true });
      writeFileSync(join(root, QUARANTINE_FILE), text);
      return () => readQuarantine(root);
    };
    expect(read("{}")).toThrow("expected a list of entries");
    expect(
      read('[{"file":"a.test.ts","test":"t","issue":288,"reason":"r"},{"file":"b.test.ts"}]'),
    ).toThrow("[1]: file and test are strings");
    expect(read('[{"file":"a.test.ts","test":"t","issue":"288","reason":"r"}]')).toThrow(
      "[0]: issue is a number and reason a string",
    );
    expect(read('[{"file":"a.test.ts","test":"t","issue":288,"reason":"r"}]')()).toEqual(
      [entry("t")].map((e) => ({ ...e, reason: "r" })),
    );
  });
});
