import { describe, expect, test } from "bun:test";
import { planRelated } from "../../lib/tests/test-related.ts";
import { fakeGit } from "./test-related-setup.ts";

describe("planRelated: the plan, its command and its warnings", () => {
  const files: Record<string, string> = {
    "apps/daemon/src/a.ts": "export const a = 1;",
    "apps/daemon/test/a.test.ts": `import "../src/a.ts";`,
  };
  const readFile = (path: string) => files[path] ?? "";
  const tracked = Object.keys(files);

  test("lists the chosen tests with the reason and runs them in one bun test call", () => {
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["apps/daemon/src/a.ts"], tracked),
      readFile,
    });
    expect(plan.code).toBe(0);
    expect(plan.output).toBe(
      [
        "test:related: 1 test file(s) for 1 changed file(s) since abc1234",
        "  apps/daemon/test/a.test.ts  imports apps/daemon/src/a.ts",
      ].join("\n"),
    );
    expect(plan.command).toEqual([
      "bun",
      "--config=bunfig.area.toml",
      "test",
      "--timeout=15000",
      "./apps/daemon/test/a.test.ts",
    ]);
  });

  test("--base replaces the merge-base", () => {
    const calls: string[][] = [];
    const git = fakeGit(["apps/daemon/src/a.ts"], tracked);
    planRelated({
      base: "v0.31.0",
      platform: "linux",
      git: (args) => {
        calls.push(args);
        return git(args);
      },
      readFile,
    });
    expect(calls.some((c) => c[0] === "merge-base")).toBe(false);
    expect(calls).toContainEqual(["diff", "--name-only", "--no-renames", "v0.31.0...HEAD"]);
  });

  test("an unknown base fails with code 2", () => {
    const plan = planRelated({
      platform: "linux",
      git: fakeGit([], tracked, { base: null }),
      readFile,
    });
    expect(plan).toEqual({
      code: 2,
      output: "test:related: no base to compare with",
      command: null,
    });
  });

  test("nothing related means nothing to run", () => {
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["docs/SPEC.md"], tracked),
      readFile,
    });
    expect(plan.code).toBe(0);
    expect(plan.command).toBeNull();
    expect(plan.output).toBe(
      "test:related: no test file is related to the 1 changed file(s) since abc1234",
    );
  });

  test("a change that reaches every test is flagged", () => {
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["bunfig.area.toml", "apps/daemon/src/a.ts"], tracked),
      readFile,
    });
    expect(plan.output).toContain(
      "warning: bunfig.area.toml affects every test, run the full suite",
    );
  });

  test("more than 60 files go through the slot", () => {
    const many: Record<string, string> = { "apps/daemon/src/a.ts": "export const a = 1;" };
    for (let i = 0; i < 61; i++) many[`apps/daemon/test/t${i}.test.ts`] = `import "../src/a.ts";`;
    const plan = planRelated({
      platform: "win32",
      git: fakeGit(["apps/daemon/src/a.ts"], Object.keys(many)),
      readFile: (p) => many[p] ?? "",
    });
    expect(plan.command?.slice(0, 6)).toEqual([
      "bun",
      "run",
      "slot",
      "--",
      "bun",
      "--config=bunfig.area.toml",
    ]);
    // win32: the Windows runners get 30 s per test (#534).
    expect(plan.command).toContain("--timeout=30000");
    expect(plan.command?.length).toBe(6 + 2 + 61);
  });
});
