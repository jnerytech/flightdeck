import { describe, expect, test } from "bun:test";
import { importsOf, planRelated, resolveImport, selectRelated } from "../lib/test-related.ts";

const sources = (files: Record<string, string>) => new Map(Object.entries(files));

describe("importsOf", () => {
  test("reads static imports, re-exports, side-effect imports and import()", () => {
    const source = [
      `import a from "./a.ts";`,
      `import type { B } from "../b";`,
      `import "./side.ts";`,
      `import {`,
      `  c,`,
      `} from "@/lib/c";`,
      `export * from "./d.ts";`,
      `export { e } from "./e.ts";`,
      `const f = await import("./f.ts");`,
      `import g from "react";`,
    ].join("\n");
    expect(importsOf(source)).toEqual([
      "./a.ts",
      "../b",
      "./side.ts",
      "@/lib/c",
      "./d.ts",
      "./e.ts",
      "./f.ts",
      "react",
    ]);
  });

  test("a source without imports has none", () => {
    expect(importsOf("export const x = 1;")).toEqual([]);
  });
});

describe("resolveImport", () => {
  const known = new Set([
    "apps/daemon/src/a.ts",
    "apps/daemon/src/dir/index.ts",
    "apps/desktop/src/lib/c.ts",
    "apps/desktop/src/ui/Card.tsx",
    "apps/desktop/test/helper.ts",
    "packages/protocol/src/index.ts",
  ]);

  test("relative specifiers, with and without extension or index", () => {
    expect(resolveImport("apps/daemon/test/x.test.ts", "../src/a.ts", known)).toBe(
      "apps/daemon/src/a.ts",
    );
    expect(resolveImport("apps/daemon/test/x.test.ts", "../src/a", known)).toBe(
      "apps/daemon/src/a.ts",
    );
    expect(resolveImport("apps/daemon/src/a.ts", "./dir", known)).toBe(
      "apps/daemon/src/dir/index.ts",
    );
    expect(resolveImport("apps/desktop/test/t.test.tsx", "../src/ui/Card", known)).toBe(
      "apps/desktop/src/ui/Card.tsx",
    );
  });

  test("the desktop alias and the protocol package", () => {
    expect(resolveImport("apps/desktop/src/x.ts", "@/lib/c", known)).toBe(
      "apps/desktop/src/lib/c.ts",
    );
    expect(resolveImport("apps/daemon/src/x.ts", "@flightdeck/protocol", known)).toBe(
      "packages/protocol/src/index.ts",
    );
  });

  test("packages, assets and missing files resolve to nothing", () => {
    expect(resolveImport("apps/daemon/src/x.ts", "react", known)).toBeNull();
    expect(resolveImport("apps/daemon/src/x.ts", "./missing", known)).toBeNull();
    expect(resolveImport("apps/desktop/src/x.ts", "./style.css", known)).toBeNull();
  });
});

describe("selectRelated", () => {
  const graph = sources({
    "apps/daemon/src/leaf.ts": "export const x = 1;",
    "apps/daemon/src/mid.ts": `import { x } from "./leaf.ts";`,
    "apps/daemon/src/other.ts": "export const y = 1;",
    "apps/daemon/test/helper.ts": `import { x } from "../src/mid.ts";`,
    "apps/daemon/test/direct.test.ts": `import { x } from "../src/leaf.ts";`,
    "apps/daemon/test/deep.test.ts": `import "./helper.ts";`,
    "apps/daemon/test/unrelated.test.ts": `import "../src/other.ts";`,
    "apps/daemon/test/cycle.test.ts": `import "../src/cycle-a.ts";`,
    "apps/daemon/src/cycle-a.ts": `import "./cycle-b.ts"; import "./leaf.ts";`,
    "apps/daemon/src/cycle-b.ts": `import "./cycle-a.ts";`,
  });

  test("a changed test file runs itself", () => {
    expect(selectRelated(["apps/daemon/test/unrelated.test.ts"], graph)).toEqual([
      { path: "apps/daemon/test/unrelated.test.ts", why: "changed" },
    ]);
  });

  test("tests that reach a changed source, directly or through helpers and cycles", () => {
    expect(selectRelated(["apps/daemon/src/leaf.ts"], graph)).toEqual([
      { path: "apps/daemon/test/cycle.test.ts", why: "imports apps/daemon/src/leaf.ts" },
      { path: "apps/daemon/test/deep.test.ts", why: "imports apps/daemon/src/leaf.ts" },
      { path: "apps/daemon/test/direct.test.ts", why: "imports apps/daemon/src/leaf.ts" },
    ]);
  });

  test("a test that is changed and also reached says changed", () => {
    expect(
      selectRelated(["apps/daemon/test/direct.test.ts", "apps/daemon/src/leaf.ts"], graph).find(
        (r) => r.path === "apps/daemon/test/direct.test.ts",
      ),
    ).toEqual({ path: "apps/daemon/test/direct.test.ts", why: "changed" });
  });

  test("files outside the graph select nothing", () => {
    expect(selectRelated(["docs/SPEC.md", "apps/daemon/src/gone.ts"], graph)).toEqual([]);
  });
});

describe("planRelated", () => {
  const BASE = "abc1234def";
  const fakeGit =
    (changed: string[], tracked: string[], opts: { base?: string | null } = {}) =>
    (args: string[]): string | null => {
      if (args[0] === "merge-base") return opts.base === null ? null : `${BASE}\n`;
      if (args[0] === "diff") return changed.join("\n");
      if (args[0] === "ls-files") return tracked.join("\n");
      return null;
    };
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
    expect(calls).toContainEqual(["diff", "--name-only", "v0.31.0...HEAD"]);
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

  test("--tier runs only the tests of those tiers, says what it left out, and leaves the coverage gate to CI (#261)", () => {
    const tiered: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/test/a.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/b.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/c.test.ts": `import "../src/a.ts";`,
      "apps/daemon/test/new.test.ts": `import "../src/a.ts";`,
    };
    const tiers: Record<string, string> = {
      "apps/daemon/test/a.test.ts": "unit",
      "apps/daemon/test/b.test.ts": "integration",
      "apps/daemon/test/c.test.ts": "integration",
    };
    const plan = planRelated({
      platform: "linux",
      git: fakeGit(["apps/daemon/src/a.ts"], Object.keys(tiered)),
      readFile: (path) => tiered[path] ?? "",
      coverageDir: "/tmp/cov",
      tiers: ["unit", "component"],
      tierOf: (path) => tiers[path],
    });
    // A test the manifest does not list yet (a new file) runs: it is never silently dropped.
    expect(plan.command?.filter((arg) => arg.endsWith(".test.ts"))).toEqual([
      "./apps/daemon/test/a.test.ts",
      "./apps/daemon/test/new.test.ts",
    ]);
    expect(plan.output).toContain("--tier unit,component: 2 test file(s) left out (integration 2)");
    expect(plan.targets).toBeUndefined();
    expect(plan.command?.some((arg) => arg.startsWith("--coverage-dir"))).toBe(false);
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
    expect(plan.command).toContain("--timeout=15000");
    expect(plan.command?.length).toBe(6 + 2 + 61);
  });
});
