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

/** A `gh` scripted call by call: each answer comes from the handler, which sees the arguments. */
function scripted(handler: (args: string[], dispatched: boolean) => Partial<GhResult> | undefined) {
  const calls: string[][] = [];
  const logs: string[] = [];
  let clock = 0;
  const deps: CiBranchDeps = {
    gh: async (args) => {
      calls.push(args);
      const dispatched = calls.some((c) => c[0] === "workflow");
      const answer = handler(args, dispatched) ?? { code: 0, stdout: "[]" };
      return { code: 0, stdout: "", ...answer };
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (message) => logs.push(message),
  };
  return { calls, logs, deps };
}
const RUN = JSON.stringify({
  status: "completed",
  conclusion: "success",
  url: "https://github.com/o/r/actions/runs/77",
  jobs: [],
});

describe("ci-branch: when gh itself fails", () => {
  test("a failed list of the runs that were there before stops with exit 2 and dispatches nothing (else an old run could be taken for the new one)", async () => {
    const f = scripted((args) =>
      args[1] === "list" ? { code: 1, stderr: "HTTP 502" } : undefined,
    );
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
    expect(f.calls.some((c) => c[0] === "workflow")).toBe(false);
    expect(f.logs.join("\n")).toContain("HTTP 502");
  });

  test("a list of the earlier runs that is not JSON stops with exit 2 and dispatches nothing, saying what gh answered", async () => {
    const f = scripted((args) =>
      args[1] === "list" ? { code: 0, stdout: "<html>rate limited</html>" } : undefined,
    );
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
    expect(f.calls.some((c) => c[0] === "workflow")).toBe(false);
    expect(f.logs.join("\n")).toContain("did not answer JSON: <html>rate limited</html>");
  });

  test("a refused dispatch shows what gh said on stderr, where gh writes its errors", async () => {
    const f = scripted((args) =>
      args[0] === "workflow" ? { code: 1, stdout: "", stderr: "HTTP 422: no ref" } : undefined,
    );
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
    expect(f.logs.join("\n")).toContain("HTTP 422: no ref");
  });

  test("one failed look at the run is retried, and the wait goes on", async () => {
    let views = 0;
    const f = scripted((args, dispatched) => {
      if (args[1] === "list") return { stdout: dispatched ? '[{"databaseId":77}]' : "[]" };
      if (args[1] === "view")
        return ++views === 1 ? { code: 1, stderr: "timeout" } : { stdout: RUN };
      return undefined;
    });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(0);
  });

  test("a run that cannot be looked at exits 2 with the reason, not with a stack trace", async () => {
    const f = scripted((args, dispatched) => {
      if (args[1] === "list") return { stdout: dispatched ? '[{"databaseId":77}]' : "[]" };
      if (args[1] === "view") return { code: 1, stderr: "HTTP 503" };
      return undefined;
    });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
    expect(f.logs.join("\n")).toContain("HTTP 503");
  });

  test("an answer that is not JSON exits 2 too", async () => {
    const f = scripted((args, dispatched) => {
      if (args[1] === "list") return { stdout: dispatched ? '[{"databaseId":77}]' : "[]" };
      if (args[1] === "view") return { stdout: "<html>" };
      return undefined;
    });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
  });

  test("a cancelled run is not a red CI: exit 2, and the log says it was cancelled", async () => {
    const f = scripted((args, dispatched) => {
      if (args[1] === "list") return { stdout: dispatched ? '[{"databaseId":77}]' : "[]" };
      if (args[1] === "view") return { stdout: RUN.replace('"success"', '"cancelled"') };
      return undefined;
    });
    expect(await ciBranch("fix-x", f.deps, FAST)).toBe(2);
    expect(f.logs.join("\n")).toContain("cancelled");
  });
});

/** The workflow read as data, not as text: a rename of a key or a reflow of the file keeps these true. */
interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: { name?: string; path?: string };
}
interface Workflow {
  on: { workflow_dispatch: { inputs: { only: { options: string[]; default: string } } } };
  concurrency: { group: string };
  jobs: Record<string, { name?: string; if?: string; steps: Step[] }>;
}

describe("ci.yml: any pushed branch can run the full CI by hand", () => {
  const ci = read(".github/workflows/ci.yml");
  const workflow = Bun.YAML.parse(ci) as Workflow;

  test("declares workflow_dispatch with an input that picks only the screenshots job", () => {
    const only = workflow.on.workflow_dispatch.inputs.only;
    expect(only.options).toEqual(["all", "screenshots"]);
    expect(only.default).toBe("all");
  });

  test("the test job is skipped when only the screenshots were asked for, and not otherwise", () => {
    expect(workflow.jobs.test?.if).toBe(
      "github.event_name != 'workflow_dispatch' || inputs.only != 'screenshots'",
    );
    expect(workflow.jobs.screenshots?.if).toBeUndefined();
  });

  test("a dispatched run never cancels the branch's push or pull request run, and skips SonarCloud", () => {
    // The job choice is in the key too: a screenshots-only dispatch must not cancel a full one.
    expect(workflow.concurrency.group).toBe(
      "ci-${{ github.ref }}-${{ github.event_name }}-${{ inputs.only }}",
    );
    const sonar = workflow.jobs.test?.steps.filter((step) =>
      step.if?.includes("workflow_dispatch"),
    );
    expect(sonar?.length).toBeGreaterThan(0);
    for (const step of sonar ?? []) {
      expect(step.if).toContain("github.event_name != 'workflow_dispatch'");
    }
  });

  test("a dispatched run's test jobs never carry the names the branch rules require (a skipped copy must not stand in for the real check)", () => {
    const name = workflow.jobs.test?.name ?? "";
    expect(name).toContain("test (${{ matrix.os }})");
    expect(name).toContain("github.event_name == 'workflow_dispatch'");
  });

  test("the screenshots job uploads the prints and the Playwright report, even when a step failed", () => {
    const uploads = (workflow.jobs.screenshots?.steps ?? []).filter((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(uploads.map((step) => [step.with?.name, step.with?.path, step.if])).toEqual([
      ["relatorio-e2e", "playwright-report", "always()"],
      ["prints", "apps/desktop/screenshots", "always()"],
    ]);
  });

  test("ci-branch.sh is a thin wrapper over the script and the package has the command", () => {
    expect(read("scripts/ci-branch.sh")).toContain("scripts/ci-branch.ts");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["ci:branch"]).toBe("bun run scripts/ci-branch.ts");
  });
});
