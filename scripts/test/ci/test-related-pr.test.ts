import { describe, expect, test } from "bun:test";
import { listSelection, planRelated } from "../../lib/tests/test-related.ts";
import { fakeGit } from "./test-related-setup.ts";

describe("planRelated: --pr and --list (#309, #399, #410)", () => {
  test("--pr runs every unit and component test plus the related tests of the other tiers, with the changed-file gate (#309)", () => {
    const repo: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/src/b.ts": "export const b = 1;",
      "apps/daemon/test/unit-a.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/unit-b.test.ts": `import "../src/b.ts";`,
      "apps/desktop/test/screen.test.tsx": `import "../../daemon/src/b.ts";`,
      "apps/daemon/test/int-a.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/int-b.test.ts": `import "../src/b.ts";`,
      "apps/daemon/test/new-a.test.ts": `import "../src/a.ts";`,
    };
    const tiers: Record<string, string> = {
      "apps/daemon/test/unit-a.test.ts": "unit",
      "apps/daemon/test/unit-b.test.ts": "unit",
      "apps/desktop/test/screen.test.tsx": "component",
      "apps/daemon/test/int-a.test.ts": "integration",
      "apps/daemon/test/int-b.test.ts": "integration",
    };
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["apps/daemon/src/a.ts"], Object.keys(repo)),
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
      pyramid: true,
      tierOf: (path) => tiers[path],
    });
    expect(plan.command?.filter((arg) => /\.test\.tsx?$/.test(arg))).toEqual([
      "./apps/daemon/test/int-a.test.ts",
      "./apps/daemon/test/new-a.test.ts",
      "./apps/daemon/test/unit-a.test.ts",
      "./apps/daemon/test/unit-b.test.ts",
      "./apps/desktop/test/screen.test.tsx",
    ]);
    expect(plan.targets).toEqual(["apps/daemon/src/a.ts"]);
    expect(plan.command).toContain("--coverage-dir=/tmp/cov");
    expect(plan.output).toContain(
      "test:related --pr: 3 fast-tier test file(s) + 2 related test file(s) of the other tiers for 1 changed file(s)",
    );
  });

  test("--pr with no changed source still runs the fast tiers, and slot: false never wraps a big run (#309)", () => {
    const repo: Record<string, string> = { "docs/x.md": "x" };
    const tiers: Record<string, string> = {};
    for (let i = 0; i < 61; i++) {
      repo[`apps/daemon/test/u${i}.test.ts`] = "export {};";
      tiers[`apps/daemon/test/u${i}.test.ts`] = "unit";
    }
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["docs/x.md"], Object.keys(repo)),
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
      pyramid: true,
      slot: false,
      tierOf: (path) => tiers[path],
    });
    expect(plan.code).toBe(0);
    expect(plan.command?.[0]).toBe("bun");
    expect(plan.command?.filter((arg) => arg.endsWith(".test.ts"))).toHaveLength(61);
  });

  test("--pr runs the whole suite when a file every test reads changed, or a test file went away (#309)", () => {
    const repo: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/test/a.test.ts": `import "../src/a.ts";`,
    };
    const calls: string[][] = [];
    const git = (changed: string[]) => (args: string[]) => {
      calls.push(args);
      return fakeGit(changed, Object.keys(repo))(args);
    };
    const tiers = { "apps/daemon/test/a.test.ts": "unit" } as Record<string, string>;
    for (const changed of [["bun.lock"], ["apps/daemon/test/gone.test.ts"]]) {
      const plan = planRelated({
        platform: "linux",
        git: git(changed),
        readFile: (path) => repo[path] ?? "",
        coverageDir: "/tmp/cov",
        pyramid: true,
        slot: false,
        tierOf: (path) => tiers[path],
      });
      expect(plan.command).toEqual(["bun", "run", "test"]);
      expect(plan.targets).toBeUndefined();
      // #996: the entry reads this report to say why a whole-suite run failed.
      expect(plan.wholeCoverage).toBe("coverage/lcov.info");
      expect(plan.output).toContain("test:related --pr: the whole suite runs");
    }
    // A rename shows its old path as gone, so a renamed test counts as one that went away.
    expect(calls.find((c) => c[0] === "diff")).toContain("--no-renames");
  });

  test("--pr gives its selection as data: the test files it runs, or 'all' when the whole suite runs (#399)", () => {
    const repo: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/test/int-a.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/int-b.test.ts": "export {};",
      "apps/daemon/test/u1.test.ts": "export {};",
    };
    const tiers: Record<string, string> = {
      "apps/daemon/test/int-a.test.ts": "integration",
      "apps/daemon/test/int-b.test.ts": "integration",
      "apps/daemon/test/u1.test.ts": "unit",
    };
    const plan = (changed: string[]) =>
      planRelated({
        platform: "win32",
        git: fakeGit(changed, Object.keys(repo)),
        readFile: (path) => repo[path] ?? "",
        pyramid: true,
        slot: false,
        tierOf: (path) => tiers[path],
      });
    expect(plan(["apps/daemon/src/a.ts"]).files).toEqual([
      "apps/daemon/test/int-a.test.ts",
      "apps/daemon/test/u1.test.ts",
    ]);
    expect(plan(["bun.lock"]).files).toBe("all");
  });

  test("--pr never selects a mod's test: bun ignores mods/ (they run under claude plugin test), and the Windows shards refuse names they cannot run (#410)", () => {
    const repo: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/test/u1.test.ts": "export {};",
      "mods/flightdeck/hooks/register.test.tsx": "export {};",
    };
    const tiers: Record<string, string> = {
      "apps/daemon/test/u1.test.ts": "unit",
      "mods/flightdeck/hooks/register.test.tsx": "unit",
    };
    const plan = planRelated({
      platform: "win32",
      git: fakeGit(["apps/daemon/src/a.ts"], Object.keys(repo)),
      readFile: (path) => repo[path] ?? "",
      pyramid: true,
      slot: false,
      tierOf: (path) => tiers[path],
    });
    expect(plan.files).toEqual(["apps/daemon/test/u1.test.ts"]);
  });

  test("listSelection writes one test file per line, or '*' for the whole suite, and needs a file name (#410 review)", () => {
    const written: Record<string, string> = {};
    const write = (path: string, text: string) => {
      written[path] = text;
    };
    expect(
      listSelection(
        { code: 0, output: "", command: null, files: ["a.test.ts", "b.test.ts"] },
        "s.txt",
        write,
      ),
    ).toEqual({ code: 0, line: "test:related: 2 line(s) written to s.txt" });
    expect(written["s.txt"]).toBe("a.test.ts\nb.test.ts\n");
    expect(
      listSelection({ code: 0, output: "", command: null, files: "all" }, "all.txt", write).code,
    ).toBe(0);
    expect(written["all.txt"]).toBe("*\n");
    // A plan that failed writes an empty list and keeps its code.
    expect(listSelection({ code: 2, output: "", command: null }, "bad.txt", write).code).toBe(2);
    expect(written["bad.txt"]).toBe("");
    for (const name of [undefined, "--pr"]) {
      const r = listSelection({ code: 0, output: "", command: null, files: [] }, name, write);
      expect(r).toEqual({
        code: 2,
        line: "test:related: --list needs a file to write the selection to",
      });
    }
  });

  test("--pr names how many fast-tier tests run, not each one; it lists the related tests (#309)", () => {
    const repo: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/test/int-a.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/u1.test.ts": "export {};",
      "apps/daemon/test/u2.test.ts": "export {};",
    };
    const tiers: Record<string, string> = {
      "apps/daemon/test/int-a.test.ts": "integration",
      "apps/daemon/test/u1.test.ts": "unit",
      "apps/daemon/test/u2.test.ts": "unit",
    };
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["apps/daemon/src/a.ts"], Object.keys(repo)),
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
      pyramid: true,
      tierOf: (path) => tiers[path],
    });
    expect(plan.output).toContain("apps/daemon/test/int-a.test.ts");
    expect(plan.output).not.toContain("u1.test.ts");
  });
});
