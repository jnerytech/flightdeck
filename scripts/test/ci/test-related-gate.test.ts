import { describe, expect, test } from "bun:test";
import { keepCoverageProblem, planRelated } from "../../lib/tests/test-related.ts";
import { BASE, fakeGit } from "./test-related-setup.ts";

describe("planRelated: the tiers, the JUnit path and the changed-file gate (#261, #762, #1003)", () => {
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

  test("#1003: with a JUnit path, the run also writes each test's time there; without one, nothing changes", () => {
    const repo: Record<string, string> = {
      "apps/daemon/src/a.ts": "export const a = 1;",
      "apps/daemon/test/a.test.ts": `import "../src/a.ts";`,
    };
    const plan = (junit?: string) =>
      planRelated({
        platform: "linux",
        git: fakeGit(["apps/daemon/src/a.ts"], Object.keys(repo)),
        readFile: (path) => repo[path] ?? "",
        coverageDir: "/tmp/cov",
        ...(junit ? { junit } : {}),
      }).command ?? [];
    const withJunit = plan("/tmp/junit.xml");
    expect(
      withJunit.slice(
        withJunit.indexOf("--reporter=junit"),
        withJunit.indexOf("--reporter=junit") + 2,
      ),
    ).toEqual(["--reporter=junit", "--reporter-outfile=/tmp/junit.xml"]);
    expect(plan().some((arg) => arg.startsWith("--reporter"))).toBe(false);
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
      "scripts/entry.ts: newly imported by a changed test, so it is held to the 80% gate too (#762)",
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
});
