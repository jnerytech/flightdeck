import { describe, expect, test } from "bun:test";
import { grade, type RunFacts, sessionArgs } from "../lib/harness-eval.ts";
import { splitShards, testFiles } from "../lib/test-shards.ts";

const LIMIT_MS = 250;

/** How long a call takes, in milliseconds. */
function took(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("sonar-scripts2: testFiles reads the test-file suffix with the same matches", () => {
  test("`.` or `_` before test or spec, then an optional c or m, js or ts, and an optional x", () => {
    const names = [
      "a.test.ts",
      "a_test.ts",
      "a.spec.tsx",
      "a_spec.mjs",
      "a.test.cjs",
      "a.test.jsx",
      "a.test.mts",
      "dir/b_spec.js",
      "c.test.test.ts",
    ];
    expect(testFiles(names)).toEqual([...names].sort());
  });

  test("another separator, a longer word, another extension or a trailing suffix is not a test file", () => {
    expect(
      testFiles([
        "a-test.ts",
        "a test.ts",
        "atest.ts",
        "a.testing.ts",
        "a.tests.ts",
        "a.test.json",
        "a.test.ts.bak",
        "a.test.xts",
        "a.test.ets",
        "a.test",
        "test.ts",
        "mods/a.test.ts",
      ]),
    ).toEqual([]);
  });

  test("a very long path is read in linear time", () => {
    const long = `${"._test".repeat(4000)}.ts`;
    const miss = `${"a.test".repeat(4000)}.json`;
    let found: string[] = [];
    let missed: string[] = [];
    const elapsed = took(() => {
      found = testFiles([long]);
      missed = testFiles([miss]);
    });
    expect(found).toEqual([long]);
    expect(missed).toEqual([]);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });

  test("each shard comes back in name order, and the input is left as it was", () => {
    const files = ["b", "c", "a", "d"];
    const split = splitShards(files, { a: 4, b: 3, c: 2, d: 1 }, 2);
    expect(split).toEqual([
      ["a", "d"],
      ["b", "c"],
    ]);
    expect(files).toEqual(["b", "c", "a", "d"]);
  });
});

const TASK = {
  name: "slug-case",
  area: "slug-case",
  testFile: "scripts/test/slug-case.test.ts",
  prompt: "…",
};

/** A run whose only bun test of the area printed `output`, then committed the test. */
const redWith = (output: string): RunFacts => ({
  steps: [
    { command: "bun --config=bunfig.area.toml test scripts/test/slug-case.test.ts", output },
    { command: 'git commit -m "test(slug-case): red"', output: "" },
  ],
  commits: [],
  costUsd: 0,
  turns: 0,
  denials: 0,
  isError: false,
  auditCode: 0,
  relatedCode: 0,
});

const isRed = (output: string) => grade(TASK, redWith(output))["red-by-assertion"];
const ASSERT = "error: expect(received).toBe(expected)";

describe("sonar-scripts2: the grader finds a fail count with the same matches", () => {
  test("a line of its own with a count from 1 up, after any white space, is a fail", () => {
    for (const count of ["1 fail", "2 fail", "10 fail", "907 fail"]) {
      expect(isRed(`${ASSERT}\n${count}`)).toBe(true);
      expect(isRed(`${ASSERT}\n ${count}\n`)).toBe(true);
    }
    expect(isRed(`${ASSERT}\n 0 pass\n\t 3 fail\n`)).toBe(true);
    expect(isRed(`${ASSERT}\n \n\n  2 fail`)).toBe(true);
    expect(isRed(`${ASSERT}\r\n 1 fail\r\n`)).toBe(true);
    expect(isRed(`${ASSERT}\u2028 1 fail`)).toBe(true);
    expect(isRed(`${ASSERT}\n\u00a0\v\f 1 fail`)).toBe(true);
  });

  test("a zero, a longer word, text before the count or after `fail` is not a fail line", () => {
    for (const text of [
      " 0 fail",
      "00 fail",
      "1 failed",
      "1 fails",
      "1  fail",
      "1fail",
      "x 1 fail",
      "- 1 fail",
      "1 fail.",
      "1 fail ",
      "fail",
      "1 pass",
      "",
    ]) {
      expect(isRed(`${ASSERT}\n${text}`)).toBe(false);
      expect(isRed(`${ASSERT}\n${text}\n`)).toBe(false);
    }
  });

  test("the assertion error is still needed next to the count", () => {
    expect(isRed("error: Cannot find module './x'\n 1 fail")).toBe(false);
  });

  test("a long run of blank lines or white space is scanned in linear time", () => {
    const outputs = [
      `${ASSERT}\n${"\n".repeat(20_000)}`,
      `${ASSERT}\n${" \n".repeat(10_000)}`,
      `${ASSERT}\n${"\n  ".repeat(7_000)}x`,
      `${ASSERT}\n${" ".repeat(20_000)}x`,
    ];
    let red: boolean[] = [];
    const elapsed = took(() => {
      red = outputs.map(isRed);
    });
    expect(red).toEqual([false, false, false, false]);
    expect(isRed(`${outputs[1]}1 fail`)).toBe(true);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-scripts2: sessionArgs drops the trailing separators of the home folder", () => {
  const options = { model: "sonnet", budget: "1" };
  const homeDenied = (dir: string, home: string) =>
    sessionArgs("task", options, { dir, home }).includes("Read(~/**)");

  test("a trailing slash or backslash, or a run of them, does not change what is inside the home", () => {
    expect(homeDenied("/home/me/tmp/x", "/home/me")).toBe(false);
    expect(homeDenied("/home/me/tmp/x", "/home/me/")).toBe(false);
    expect(homeDenied("/home/me/tmp/x", "/home/me//")).toBe(false);
    expect(homeDenied("C:\\Users\\me\\tmp", "C:\\Users\\me\\")).toBe(false);
    expect(homeDenied("C:\\Users\\me\\tmp", "C:\\Users\\me\\/\\")).toBe(false);
    expect(homeDenied("/home/me", "/home/me/")).toBe(false);
  });

  test("a folder next to the home, or elsewhere, is outside it", () => {
    expect(homeDenied("/home/mealtime/x", "/home/me/")).toBe(true);
    expect(homeDenied("/tmp/fd-eval-x", "/home/me//")).toBe(true);
    expect(homeDenied("/home/me2", "/home/me")).toBe(true);
  });

  test("a home that is only separators is the root: every absolute folder is inside it", () => {
    expect(homeDenied("/tmp/x", "/")).toBe(false);
    expect(homeDenied("/tmp/x", "///")).toBe(false);
    expect(homeDenied("tmp/x", "/")).toBe(true);
  });

  test("a separator in the middle stays, and only the end is trimmed", () => {
    expect(homeDenied("/home//me/x", "/home//me/")).toBe(false);
    expect(homeDenied("/home/me/x", "/home//me/")).toBe(true);
  });

  test("a long run of separators is trimmed in linear time", () => {
    const slashes = "/".repeat(20_000);
    const mixed = "\\/".repeat(10_000);
    let results: boolean[] = [];
    const elapsed = took(() => {
      results = [
        homeDenied("/home/me/x", `/home/me${slashes}`),
        homeDenied("/home/me/x", `/home/me${mixed}`),
        homeDenied("/home/me/x", `/home/me${slashes}x`),
        homeDenied("/home/me/x", `/home/me${mixed}x`),
      ];
    });
    expect(results).toEqual([false, false, true, true]);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });
});
