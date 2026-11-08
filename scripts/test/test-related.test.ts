import { describe, expect, test } from "bun:test";
import {
  importsOf,
  keepCoverageProblem,
  listSelection,
  newImports,
  planRelated,
  resolveImport,
  selectRelated,
} from "../lib/test-related.ts";

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

  test("a long run of spaces after the keyword is scanned in linear time (#363)", () => {
    const spaces = " ".repeat(20_000);
    const started = performance.now();
    const none = importsOf(`import${spaces}x`);
    const open = importsOf(`import(${spaces}"./a.ts")`);
    const plain = importsOf(`from${spaces}'./b.ts'`);
    const elapsed = performance.now() - started;
    expect(none).toEqual([]);
    expect(open).toEqual(["./a.ts"]);
    expect(plain).toEqual(["./b.ts"]);
    // The nested `\s*\(?\s*` of the old pattern took about 0.7 s here for the first call alone.
    expect(elapsed).toBeLessThan(250);
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

  test("a protocol subpath and any other workspace package resolve too, so no internal import falls out of the graph (#309)", () => {
    const more = new Set([...known, "packages/protocol/src/run.ts", "packages/other/src/index.ts"]);
    expect(resolveImport("apps/daemon/src/x.ts", "@flightdeck/protocol/run", more)).toBe(
      "packages/protocol/src/run.ts",
    );
    expect(resolveImport("apps/daemon/src/x.ts", "@flightdeck/other", more)).toBe(
      "packages/other/src/index.ts",
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

describe("newImports (#762)", () => {
  const repo = sources({
    "scripts/lib/a.ts": "export const a = 1;",
    "scripts/lib/b.ts": "export const b = 1;",
    "scripts/lib/c.ts": "export const c = 1;",
    "scripts/test/a.test.ts": `import "../lib/a.ts";\nimport "../lib/b.ts";\nimport "bun:test";`,
    "scripts/test/new.test.ts": `import "../lib/c.ts";\nimport "@flightdeck/protocol";`,
    "packages/protocol/src/index.ts": "export const p = 1;",
  });
  const atBase: Record<string, string> = { "scripts/test/a.test.ts": `import "../lib/a.ts";` };
  const before = (path: string) => atBase[path] ?? null;

  test("names a file a changed test imports now and did not import at the base", () => {
    expect(newImports(["scripts/test/a.test.ts"], repo, before)).toEqual(["scripts/lib/b.ts"]);
  });

  test("a new test brings every file it imports, a workspace package's index too, and bun:test is left out", () => {
    expect(
      newImports(["scripts/test/a.test.ts", "scripts/test/new.test.ts"], repo, before),
    ).toEqual(["packages/protocol/src/index.ts", "scripts/lib/b.ts", "scripts/lib/c.ts"]);
  });

  test("a file the same change also edits is still named: #695 changed demo-shots.ts and its new importer at once", () => {
    expect(newImports(["scripts/test/a.test.ts", "scripts/lib/b.ts"], repo, before)).toEqual([
      "scripts/lib/b.ts",
    ]);
  });

  test("a changed source file or a removed test brings nothing", () => {
    expect(newImports(["scripts/lib/a.ts", "scripts/test/gone.test.ts"], repo, before)).toEqual([]);
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

  test("#762: a scripts/ entry file changed in the same diff as its new importer is gated, once", () => {
    const repo: Record<string, string> = {
      "scripts/entry.ts": "export const names = 1;",
      "scripts/test/narrow.test.ts": `import "../entry.ts";`,
    };
    const base = fakeGit(["scripts/entry.ts", "scripts/test/narrow.test.ts"], Object.keys(repo));
    const plan = planRelated({
      platform: "linux",
      git: (args) => (args[0] === "show" ? "" : base(args)),
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
    });
    expect(plan.targets).toEqual(["scripts/entry.ts"]);
  });

  test("#762 review: a lib file both changed and newly imported is one target", () => {
    const repo: Record<string, string> = {
      "scripts/lib/x.ts": "export const x = 1;",
      "scripts/test/x.test.ts": `import "../lib/x.ts";`,
    };
    const base = fakeGit(["scripts/lib/x.ts", "scripts/test/x.test.ts"], Object.keys(repo));
    const plan = planRelated({
      platform: "linux",
      git: (args) => (args[0] === "show" ? "" : base(args)),
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
    });
    expect(plan.targets).toEqual(["scripts/lib/x.ts"]);
  });

  test("#762 review: the test is read at the merge-base the diff compares with, not at the base's tip", () => {
    const repo: Record<string, string> = {
      "scripts/entry.ts": "export const names = 1;",
      "scripts/test/narrow.test.ts": `import "../entry.ts";`,
    };
    const shown: string[] = [];
    const plan = planRelated({
      base: "main",
      platform: "linux",
      git: (args) => {
        if (args.join(" ") === "merge-base main HEAD") return "mb4567\n";
        if (args[0] === "diff") return "scripts/test/narrow.test.ts";
        if (args[0] === "ls-files") return Object.keys(repo).join("\n");
        if (args[0] === "show") {
          shown.push(args[1] as string);
          return args[1] === "mb4567:scripts/test/narrow.test.ts" ? `import "../entry.ts";` : "";
        }
        return null;
      },
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
    });
    expect(shown).toEqual(["mb4567:scripts/test/narrow.test.ts"]);
    expect(plan.targets).toEqual([]);
  });

  test("#762 review: a newly imported file brings only the tests that import it themselves, not a hub's whole tree", () => {
    const repo: Record<string, string> = {
      "scripts/lib/hub.ts": "export const hub = 1;",
      "scripts/lib/mid.ts": `import "./hub.ts";`,
      "scripts/test/new.test.ts": `import "../lib/hub.ts";`,
      "scripts/test/hub.test.ts": `import "../lib/hub.ts";`,
      "scripts/test/far.test.ts": `import "../lib/mid.ts";`,
    };
    const base = fakeGit(["scripts/test/new.test.ts"], Object.keys(repo));
    const plan = planRelated({
      platform: "linux",
      git: (args) => (args[0] === "show" ? null : base(args)),
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
    });
    expect(plan.command?.filter((arg) => arg.endsWith(".test.ts"))).toEqual([
      "./scripts/test/hub.test.ts",
      "./scripts/test/new.test.ts",
    ]);
  });

  test("#762: a file a changed test newly imports joins the changed-file gate, with its own tests", () => {
    const repo: Record<string, string> = {
      "scripts/entry.ts": "export const names = 1;",
      "scripts/lib/narrow.ts": "export const narrow = 1;",
      "scripts/test/narrow.test.ts": `import "../lib/narrow.ts";\nimport "../entry.ts";`,
      "scripts/test/entry.test.ts": `import "../entry.ts";`,
    };
    const base = fakeGit(["scripts/test/narrow.test.ts"], Object.keys(repo));
    const calls: string[][] = [];
    const plan = planRelated({
      platform: "linux",
      git: (args) => {
        calls.push(args);
        if (args[0] === "show")
          return args[1] === `${BASE}:scripts/test/narrow.test.ts`
            ? `import "../lib/narrow.ts";`
            : null;
        return base(args);
      },
      readFile: (path) => repo[path] ?? "",
      coverageDir: "/tmp/cov",
    });
    expect(plan.targets).toEqual(["scripts/entry.ts"]);
    expect(plan.command?.filter((arg) => arg.endsWith(".test.ts"))).toEqual([
      "./scripts/test/entry.test.ts",
      "./scripts/test/narrow.test.ts",
    ]);
    expect(plan.output).toContain(
      "scripts/entry.ts: newly imported by a changed test, so it is held to 100% too (#762)",
    );
    // Without the coverage gate there is nothing to hold it to, and git is not asked.
    calls.length = 0;
    planRelated({
      platform: "linux",
      git: (args) => {
        calls.push(args);
        return base(args);
      },
      readFile: (path) => repo[path] ?? "",
    });
    expect(calls.some((c) => c[0] === "diff")).toBe(true);
    expect(calls.some((c) => c[0] === "show")).toBe(false);
  });

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

  test("--keep-coverage needs a folder inside the repository that is not another flag (#309)", () => {
    const root = "/repo";
    expect(keepCoverageProblem(root, "coverage")).toBeNull();
    expect(keepCoverageProblem(root, "..cache/cov")).toBeNull();
    // A Windows drive path or a leading slash is outside the repository whatever the root looks like.
    for (const bad of [
      undefined,
      "--pr",
      "../x",
      "/tmp/x",
      ".",
      "D:/other",
      "C:foo",
      "\\\\server\\x",
    ]) {
      expect(`${bad}: ${keepCoverageProblem(root, bad) ?? "ok"}`).toContain(
        "--keep-coverage needs a folder inside the repository",
      );
    }
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
