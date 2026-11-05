import { describe, expect, test } from "bun:test";
import { planRelated, selectRelated } from "../lib/test-related.ts";

// a.ts <- b.ts <- b.test.ts (through b), a.ts <- a.test.ts (directly), c.test.ts changed itself.
const SOURCES = new Map([
  ["scripts/lib/a.ts", "export const a = 1;"],
  ["scripts/lib/b.ts", 'import { a } from "./a.ts"; export const b = a;'],
  ["scripts/test/a.test.ts", 'import { a } from "../lib/a.ts";'],
  ["scripts/test/b.test.ts", 'import { b } from "../lib/b.ts";'],
  ["scripts/test/c.test.ts", 'import { b } from "../lib/b.ts";'],
]);

const git = (changed: string[]) => (args: string[]) => {
  if (args[0] === "merge-base") return "abc1234\n";
  if (args[0] === "diff") return `${changed.join("\n")}\n`;
  if (args[0] === "ls-files") return [...SOURCES.keys()].join("\n");
  return null;
};

describe("related-fast", () => {
  test("direct: the changed tests and the tests that import a changed file themselves", () => {
    expect(
      selectRelated(["scripts/lib/a.ts", "scripts/test/c.test.ts"], SOURCES, { direct: true }),
    ).toEqual([
      { path: "scripts/test/a.test.ts", why: "imports scripts/lib/a.ts" },
      { path: "scripts/test/c.test.ts", why: "changed" },
    ]);
  });

  test("without direct, the transitive set still reaches the test behind b.ts", () => {
    expect(selectRelated(["scripts/lib/a.ts"], SOURCES).map((r) => r.path)).toEqual([
      "scripts/test/a.test.ts",
      "scripts/test/b.test.ts",
      "scripts/test/c.test.ts",
    ]);
  });

  test("test:related --fast runs only the direct set and says so, and still checks the coverage", () => {
    const plan = planRelated({
      platform: "linux",
      git: git(["scripts/lib/a.ts"]),
      readFile: (path) => SOURCES.get(path) ?? "",
      coverageDir: "/tmp/cov",
      fast: true,
    });
    expect(plan.output.split("\n")[0]).toBe(
      "test:related --fast: 1 test file(s) for 1 changed file(s) since abc1234 (direct importers only; CI runs the rest)",
    );
    expect(plan.command?.filter((arg) => arg.endsWith(".test.ts"))).toEqual([
      "./scripts/test/a.test.ts",
    ]);
    expect(plan.targets).toEqual(["scripts/lib/a.ts"]);
  });
});
