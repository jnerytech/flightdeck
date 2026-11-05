import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CiBranchDeps, ciBranch, type GhResult } from "../lib/ci-branch.ts";

const ROOT = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

interface Fake {
  calls: string[][];
  logs: string[];
  deps: CiBranchDeps;
}

/** A `gh` that knows the four calls the script makes. `views` is what each poll of the run answers. */
function fake(options: {
  before?: number[];
  after?: number[];
  views?: Array<{ status: string; conclusion: string | null }>;
  dispatchCode?: number;
  artifacts?: string[];
}): Fake {
  const calls: string[][] = [];
  const logs: string[] = [];
  let dispatched = false;
  let polls = 0;
  let clock = 0;
  const ok = (stdout: string): GhResult => ({ code: 0, stdout });
  const gh = async (args: string[]): Promise<GhResult> => {
    calls.push(args);
    const [a, b] = args;
    if (a === "workflow" && b === "run") {
      dispatched = true;
      return options.dispatchCode
        ? { code: options.dispatchCode, stdout: "HTTP 422: nope" }
        : ok("");
    }
    if (a === "run" && b === "list") {
      const ids = dispatched ? (options.after ?? []) : (options.before ?? []);
      return ok(JSON.stringify(ids.map((databaseId) => ({ databaseId }))));
    }
    if (a === "run" && b === "view") {
      const view = (options.views ?? [{ status: "completed", conclusion: "success" }])[
        Math.min(polls++, (options.views?.length ?? 1) - 1)
      ] as { status: string; conclusion: string | null };
      return ok(
        JSON.stringify({
          ...view,
          url: "https://github.com/o/r/actions/runs/77",
          jobs: [
            { name: "test (ubuntu-latest)", conclusion: view.conclusion },
            { name: "screenshots (prints, axe e e2e)", conclusion: view.conclusion },
          ],
        }),
      );
    }
    if (a === "api") return ok(JSON.stringify(options.artifacts ?? ["prints", "relatorio-e2e"]));
    return { code: 1, stdout: `unexpected: ${args.join(" ")}` };
  };
  return {
    calls,
    logs,
    deps: {
      gh,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: (message) => logs.push(message),
    },
  };
}

const FAST = { only: "all", appearMs: 1000, waitMs: 10_000, pollMs: 100 } as const;

describe("ci-branch: the full CI on a pushed branch, from the script", () => {
  test("dispatches ci.yml on the branch with the job choice, and takes the run that was not there before", async () => {
    const f = fake({ before: [5], after: [77, 5] });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(0);
    expect(f.calls.find((c) => c[0] === "workflow")).toEqual([
      "workflow",
      "run",
      "ci.yml",
      "--ref",
      "fix-x",
      "-f",
      "only=all",
    ]);
    expect(f.calls.some((c) => c[0] === "run" && c[1] === "view" && c[2] === "77")).toBe(true);
    expect(f.calls.some((c) => c.includes("5") && c[1] === "view")).toBe(false);
  });

  test("screenshots only is passed through to the workflow", async () => {
    const f = fake({ after: [77] });
    await ciBranch("fix-x", f.deps, { ...FAST, only: "screenshots" });
    expect(f.calls.find((c) => c[0] === "workflow")?.slice(-2)).toEqual(["-f", "only=screenshots"]);
  });

  test("waits while the run is queued or in progress, then prints the result, the jobs and how to get the artifacts", async () => {
    const f = fake({
      after: [77],
      views: [
        { status: "queued", conclusion: null },
        { status: "in_progress", conclusion: null },
        { status: "completed", conclusion: "success" },
      ],
    });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(0);
    const out = f.logs.join("\n");
    expect(out).toContain("https://github.com/o/r/actions/runs/77");
    expect(out).toContain("success");
    expect(out).toContain("screenshots (prints, axe e e2e): success");
    expect(out).toContain("gh run download 77 -n prints");
    expect(out).toContain("gh run download 77 -n relatorio-e2e");
  });

  test("a red run exits 1 and names the failing jobs", async () => {
    const f = fake({ after: [77], views: [{ status: "completed", conclusion: "failure" }] });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(1);
    expect(f.logs.join("\n")).toContain("test (ubuntu-latest): failure");
  });

  test("a branch name that is not plain refuses before any gh call", async () => {
    const f = fake({});
    expect(await ciBranch("x; rm -rf /", f.deps, FAST)).toBe(2);
    expect(await ciBranch("--ref", f.deps, FAST)).toBe(2);
    expect(f.calls).toEqual([]);
    expect(f.logs.join("\n")).toContain("branch");
  });

  test("a refused dispatch exits 2 with gh's answer", async () => {
    const f = fake({ dispatchCode: 1 });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
    expect(f.logs.join("\n")).toContain("HTTP 422: nope");
  });

  test("a run that never appears, or never finishes, exits 2 and says so", async () => {
    const none = fake({ before: [5], after: [5] });
    expect(await ciBranch("fix-x", none.deps, FAST)).toBe(2);
    expect(none.logs.join("\n")).toContain("did not appear");
    const stuck = fake({ after: [77], views: [{ status: "in_progress", conclusion: null }] });
    expect(await ciBranch("fix-x", stuck.deps, FAST)).toBe(2);
    expect(stuck.logs.join("\n")).toContain("77");
    expect(stuck.logs.join("\n")).toContain("still");
  });
});

describe("ci.yml: any pushed branch can run the full CI by hand", () => {
  const ci = read(".github/workflows/ci.yml");

  test("declares workflow_dispatch with an input that picks only the screenshots job", () => {
    expect(ci).toMatch(/\n {2}workflow_dispatch:/);
    expect(ci).toMatch(/\n {6}only:/);
    expect(ci).toContain("screenshots");
  });

  test("the test job is skipped when only the screenshots were asked for", () => {
    const test = ci.slice(ci.indexOf("  test:"), ci.indexOf("  screenshots:"));
    expect(test).toContain("inputs.only != 'screenshots'");
  });

  test("a dispatched run never cancels the branch's push or pull request run, and skips SonarCloud", () => {
    expect(ci).toMatch(/group: ci-\$\{\{ github\.ref \}\}-\$\{\{ github\.event_name \}\}/);
    const sonar = ci.slice(
      ci.indexOf("- name: Versão para o SonarCloud"),
      ci.indexOf("- name: SonarCloud"),
    );
    expect(sonar).toContain("github.event_name != 'workflow_dispatch'");
  });

  test("the screenshots job uploads the prints and the Playwright report, even when a step failed", () => {
    const job = ci.slice(ci.indexOf("  screenshots:"));
    expect(job).toMatch(/name: prints\n\s+path: apps\/desktop\/screenshots/);
    expect(job).toMatch(/name: relatorio-e2e\n\s+path: playwright-report/);
    expect(job.match(/if: always\(\)/g)?.length).toBe(2);
  });

  test("ci-branch.sh is a thin wrapper over the script and the package has the command", () => {
    expect(read("scripts/ci-branch.sh")).toContain("scripts/ci-branch.ts");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["ci:branch"]).toBe("bun run scripts/ci-branch.ts");
  });
});
