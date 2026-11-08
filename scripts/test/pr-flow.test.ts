import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CheckRun,
  checksVerdict,
  headCi,
  issueOf,
  mergeOrder,
  type Pr,
  type PrFlowDeps,
  prFlow,
  VERSION_FILE,
} from "../lib/pr-flow.ts";

const R = "repos/{owner}/{repo}";
const REQUIRED = [
  "test (ubuntu-latest)",
  "test (windows-latest)",
  "screenshots (prints, axe e e2e)",
  "SonarCloud Code Analysis",
];
const green = (): CheckRun[] =>
  REQUIRED.map((name, i) => ({ id: i + 1, name, status: "completed", conclusion: "success" }));

interface FakePr extends Pr {
  state: "open" | "closed";
  /** GitHub's mergeable_state: "dirty" when the PR conflicts with its base. */
  mergeableState?: string;
  /** The head's repository (null: a deleted fork); absent, the same repository as the base. */
  headRepo?: string | null;
  /** What `gh api` prints for this PR in place of its JSON. */
  raw?: string;
}

/** A fake GitHub behind `gh api`, and a fake git; every write is recorded. */
function fake(
  opts: {
    prs?: FakePr[];
    issues?: Record<number, string>;
    runs?: Record<string, CheckRun[]>;
    statuses?: Record<string, { context: string; state: string }[]>;
    behind?: Record<string, number>;
    subjects?: Record<string, string[]>;
    pushed?: string[];
    fail?: RegExp;
    env?: Record<string, string>;
    /** CI runs of a commit pushed to main, by SHA. */
    mainRuns?: Record<
      string,
      { id?: number; event?: string; status: string; conclusion: string | null }[]
    >;
    /** The jobs of a run, by run id. */
    runJobs?: Record<number, { name: string; conclusion: string | null }[]>;
    /** origin/main's HEAD and the commits on main. */
    mainHead?: string;
    onMain?: string[];
    tags?: string[];
    /** The first-parent commits of origin/main, newest first. */
    history?: string[];
    /** The version in apps/desktop/package.json at a commit of main, by SHA. */
    versions?: Record<string, string>;
    /** `gh run list` of a branch's PR runs, by branch (default "[]"); null: gh fails (#741). */
    prRuns?: Record<string, string | null>;
    /** `gh pr view <n> --json=mergeable,statusCheckRollup`, by PR number. */
    prViews?: Record<number, string>;
    /** The clock, in ms. */
    now?: number;
    /** The message GitHub's GraphQL answers with when it refuses. */
    graphqlError?: string;
  } = {},
) {
  const prs = opts.prs ?? [];
  const writes: string[] = [];
  const gitWrites: string[] = [];
  const lines: string[] = [];
  /** The gh run list calls, in order (#741). */
  const asked: string[] = [];
  const ok = (stdout: string) => ({ code: 0, stdout });
  const deps: PrFlowDeps = {
    gh: async (args) => {
      const line = args.join(" ");
      if (opts.fail?.test(line)) return { code: 1, stdout: "" };
      if (args[0] === "run" && args[1] === "list") {
        asked.push(line);
        const branch = args.find((a) => a.startsWith("--branch="))?.slice("--branch=".length) ?? "";
        const listed = opts.prRuns?.[branch];
        return listed === null ? { code: 1, stdout: "" } : ok(listed ?? "[]");
      }
      if (args[0] === "pr" && args[1] === "view") {
        const view = opts.prViews?.[Number(args[2])];
        return ok(view ?? JSON.stringify({ mergeable: "MERGEABLE", statusCheckRollup: [] }));
      }
      if (args.includes("-X") || args[0] === "workflow") writes.push(line);
      if (args[0] === "workflow") return ok("");
      const path = args.find((a) => a.startsWith("repos/")) ?? "";
      if (path === `${R}/rules/branches/main`) {
        return ok(
          JSON.stringify([
            { type: "deletion" },
            {
              type: "required_status_checks",
              parameters: { required_status_checks: REQUIRED.map((context) => ({ context })) },
            },
          ]),
        );
      }
      if (path.startsWith(`${R}/pulls?head=`)) {
        const head = /head=\{owner\}:([^&]+)/.exec(path)?.[1];
        return ok(
          prs
            .filter((p) => p.head === head && p.state === "open")
            .map((p) => `${p.number}\n`)
            .join(""),
        );
      }
      if (path.startsWith(`${R}/pulls?state=open`)) {
        return ok(
          prs
            .filter((p) => p.state === "open")
            .map((p) => `${JSON.stringify({ ...p, state: undefined })}\n`)
            .join(""),
        );
      }
      if (path === `${R}/pulls` && args.includes("POST")) {
        const n = 300 + prs.length;
        return ok(`${n} https://github.com/o/r/pull/${n}\n`);
      }
      let m = /^repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)(\/update-branch|\/merge)?$/.exec(path);
      if (m) {
        const pr = prs.find((p) => p.number === Number(m?.[1]));
        if (!pr) return { code: 1, stdout: "" };
        if (m[2]) return ok("{}");
        if (pr.raw !== undefined) return ok(pr.raw);
        return ok(
          JSON.stringify({
            number: pr.number,
            node_id: `PR_node${pr.number}`,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            head: {
              ref: pr.head,
              sha: pr.sha,
              ...(pr.headRepo === undefined
                ? {}
                : { repo: pr.headRepo === null ? null : { full_name: pr.headRepo } }),
            },
            base: { ref: pr.base, repo: { full_name: "o/r" } },
            mergeable_state: pr.mergeableState ?? "clean",
          }),
        );
      }
      if (args.includes("graphql")) {
        if (opts.graphqlError)
          return { code: 1, stdout: JSON.stringify({ errors: [{ message: opts.graphqlError }] }) };
        return ok(`{"data":{"enablePullRequestAutoMerge":{"clientMutationId":null}}}`);
      }
      m = /commits\/(\w+)\/check-runs/.exec(path);
      if (m) {
        return ok((opts.runs?.[m[1] ?? ""] ?? []).map((r) => `${JSON.stringify(r)}\n`).join(""));
      }
      m = /commits\/(\w+)\/status$/.exec(path);
      if (m) {
        return ok(
          (opts.statuses?.[m[1] ?? ""] ?? []).map((s) => `${JSON.stringify(s)}\n`).join(""),
        );
      }
      m = /compare\/(.+)$/.exec(path);
      if (m) return ok(`${opts.behind?.[m[1] ?? ""] ?? 0}\n`);
      m = /issues\/(\d+)$/.exec(path);
      if (m) {
        const title = opts.issues?.[Number(m[1])];
        return title === undefined ? { code: 1, stdout: "" } : ok(`${title}\n`);
      }
      m = /actions\/workflows\/ci\.yml\/runs\?head_sha=(\w+)&branch=main$/.exec(path);
      if (m) {
        return ok(
          (opts.mainRuns?.[m[1] ?? ""] ?? []).map((r) => `${JSON.stringify(r)}\n`).join(""),
        );
      }
      // One page of up to 100 jobs: the default 30 could leave the suite's job unread (#444 review).
      m = /actions\/runs\/(\d+)\/jobs\?per_page=100$/.exec(path);
      if (m) {
        return ok(
          (opts.runJobs?.[Number(m[1])] ?? []).map((j) => `${JSON.stringify(j)}\n`).join(""),
        );
      }
      return { code: 1, stdout: "" };
    },
    git: async (args) => {
      if (args[0] === "tag" || args[0] === "push") {
        gitWrites.push(args.join(" "));
        return opts.fail?.test(args.join(" ")) ? { code: 1, stdout: "" } : ok("");
      }
      if (args[0] === "merge-base") {
        return { code: (opts.onMain ?? []).includes(args[2] ?? "") ? 0 : 1, stdout: "" };
      }
      if (args[0] === "rev-parse" && (args.at(-1) ?? "").startsWith("refs/tags/")) {
        const tag = (args.at(-1) ?? "").slice("refs/tags/".length);
        return { code: (opts.tags ?? []).includes(tag) ? 0 : 1, stdout: "" };
      }
      if (args[0] === "rev-list" && args.includes("--first-parent")) {
        return ok((opts.history ?? []).map((sha) => `${sha}\n`).join(""));
      }
      // The root package.json has no version: the product's lives in apps/desktop (#559).
      if (args[0] === "show" && (args.at(-1) ?? "").endsWith(":package.json")) {
        return ok(`${JSON.stringify({ name: "flightdeck", private: true })}\n`);
      }
      if (args[0] === "show" && (args.at(-1) ?? "").endsWith(":apps/desktop/package.json")) {
        const version = opts.versions?.[(args.at(-1) ?? "").split(":")[0] ?? ""];
        return version === undefined
          ? { code: 1, stdout: "" }
          : ok(`${JSON.stringify({ name: "@flightdeck/desktop", version })}\n`);
      }
      if (args[0] === "rev-parse" && args.at(-1) === "origin/main") {
        return opts.mainHead ? ok(`${opts.mainHead}\n`) : { code: 1, stdout: "" };
      }
      if (args[0] === "rev-parse") {
        const ref = args.at(-1) ?? "";
        return {
          code: (opts.pushed ?? []).includes(ref.replace("origin/", "")) ? 0 : 1,
          stdout: "",
        };
      }
      if (args[0] === "log") {
        const range = args.at(-1) ?? "";
        const branch = range.split("..origin/")[1] ?? "";
        return ok((opts.subjects?.[branch] ?? []).map((s) => `${s}\n`).join(""));
      }
      return { code: 1, stdout: "" };
    },
    env: opts.env ?? {},
    log: (line) => lines.push(line),
    ...(opts.now === undefined ? {} : { now: () => opts.now ?? 0 }),
  };
  return { deps, writes, gitWrites, lines, asked, out: () => lines.join("\n") };
}

const pr = (number: number, head: string, extra: Partial<FakePr> = {}): FakePr => ({
  number,
  head,
  sha: `sha${number}`,
  base: "main",
  draft: false,
  title: `PR ${number}`,
  state: "open",
  ...extra,
});

describe("pr-flow: the pure parts", () => {
  test("a branch's issue is the one its subjects name most; a tie goes to the first named", () => {
    expect(issueOf(["fix(a): x (#12)", "test(a): y (#12)", "docs: z (#9)"])).toBe(12);
    expect(issueOf(["feat(a): x (#7, #8)", "fix(a): y (#8)"])).toBe(8);
    expect(issueOf(["test(a): x (#5)", "fix(a): y (#6)"])).toBe(5);
    expect(issueOf(["docs: nothing here", "chore: #3 without parentheses"])).toBeNull();
  });

  test("the merge order takes PRs onto main by number, each stacked PR right after its parent", () => {
    const order = mergeOrder([
      pr(30, "c", { base: "b" }),
      pr(12, "a"),
      pr(20, "b", { base: "a" }),
      pr(5, "x"),
      pr(40, "lone", { base: "gone-branch" }),
    ]);
    expect(order.map((p) => p.number)).toEqual([5, 12, 20, 30, 40]);
  });

  test("checks are green when the newest run of each required name passed, or a status did", () => {
    const runs: CheckRun[] = [
      ...green(),
      { id: 9, name: "test (ubuntu-latest)", status: "completed", conclusion: "failure" },
    ];
    expect(checksVerdict(REQUIRED, green(), [])).toEqual({
      green: true,
      failing: [],
      pending: [],
      missing: [],
    });
    expect(checksVerdict(REQUIRED, runs, []).failing).toEqual(["test (ubuntu-latest)"]);
    const pending = green().map((r) =>
      r.name === "SonarCloud Code Analysis" ? { ...r, status: "in_progress", conclusion: null } : r,
    );
    expect(checksVerdict(REQUIRED, pending, []).pending).toEqual(["SonarCloud Code Analysis"]);
    const noSonar = green().filter((r) => r.name !== "SonarCloud Code Analysis");
    expect(checksVerdict(REQUIRED, noSonar, [])).toMatchObject({
      green: false,
      missing: ["SonarCloud Code Analysis"],
    });
    expect(
      checksVerdict(REQUIRED, noSonar, [{ context: "SonarCloud Code Analysis", state: "success" }])
        .green,
    ).toBe(true);
    const skipped = green().map((r) => ({ ...r, conclusion: "skipped" }));
    expect(checksVerdict(REQUIRED, skipped, []).green).toBe(true);
  });

  test("a commit status stands in for a missing run: pending waits, any other state that is not success fails", () => {
    const noSonar = green().filter((r) => r.name !== "SonarCloud Code Analysis");
    const status = (state: string) => [{ context: "SonarCloud Code Analysis", state }];
    expect(checksVerdict(REQUIRED, noSonar, status("pending"))).toMatchObject({
      green: false,
      pending: ["SonarCloud Code Analysis"],
    });
    expect(checksVerdict(REQUIRED, noSonar, status("failure"))).toMatchObject({
      green: false,
      failing: ["SonarCloud Code Analysis"],
    });
  });
});

describe("pr-flow: open", () => {
  test("opens the PR by REST, titled after the branch's issue, closing it, onto main by default", async () => {
    const f = fake({
      pushed: ["oom-guard"],
      subjects: { "oom-guard": ["fix(oom-guard): x (#247)", "test(oom-guard): y (#247)"] },
      issues: { 247: "OOM on the Pi kills Claude sessions" },
    });
    expect(await prFlow(["open", "oom-guard"], f.deps)).toBe(0);
    expect(f.writes).toHaveLength(1);
    const post = f.writes[0] ?? "";
    expect(post).toContain(`api -X POST ${R}/pulls`);
    expect(post).toContain("-f title=OOM on the Pi kills Claude sessions (#247)");
    expect(post).toContain("-f head=oom-guard");
    expect(post).toContain("-f base=main");
    expect(post).toContain("-f body=Closes #247");
    expect(post).toContain("-F draft=false");
    expect(f.out()).toContain("#300 https://github.com/o/r/pull/300");
  });

  test("--base stacks it on another branch, --draft opens it as a draft, --issue names the issue", async () => {
    const f = fake({
      pushed: ["hold-proof"],
      subjects: { "hold-proof": ["docs: no number"] },
      issues: { 245: "Approval safety, second pass" },
    });
    expect(
      await prFlow(
        ["open", "hold-proof", "--base", "approval-safety-2", "--draft", "--issue", "245"],
        f.deps,
      ),
    ).toBe(0);
    const post = f.writes[0] ?? "";
    expect(post).toContain("-f base=approval-safety-2");
    expect(post).toContain("-F draft=true");
    expect(post).toContain("(#245)");
  });

  test("--issue writes Closes #n as the first body line, then the commit list (#839)", async () => {
    const f = fake({
      pushed: ["slice"],
      subjects: { slice: ["feat(slice): x (#9)", "test(slice): y (#9)"] },
      issues: { 117: "A big issue" },
    });
    expect(await prFlow(["open", "slice", "--issue", "117"], f.deps)).toBe(0);
    const post = f.writes[0] ?? "";
    expect(post).toContain("-f title=A big issue (#117)");
    expect(post).toContain("-f body=Closes #117\n\n- feat(slice): x (#9)\n- test(slice): y (#9)");
    expect(post).not.toContain("Refs #");
  });

  test("--refs writes Refs #n as the first body line, so nothing is linked for closing (#839)", async () => {
    const f = fake({
      pushed: ["slice"],
      subjects: { slice: ["feat(slice): x (#9)", "test(slice): y (#9)"] },
      issues: { 117: "A big issue" },
    });
    expect(await prFlow(["open", "slice", "--refs", "117", "--draft"], f.deps)).toBe(0);
    const post = f.writes[0] ?? "";
    // A slice is titled after its own first commit, not the parent issue (#909).
    expect(post).toContain("-f title=y (#117) -f head=");
    expect(post).toContain("-f body=Refs #117\n\n- feat(slice): x (#9)\n- test(slice): y (#9)");
    expect(post).toContain("-F draft=true");
    expect(post).not.toContain("Closes #");
  });

  test("--issue and --refs together are refused with a clear message and open nothing (#839)", async () => {
    const f = fake({
      pushed: ["slice"],
      subjects: { slice: ["feat(slice): x (#9)"] },
      issues: { 117: "A big issue" },
    });
    expect(await prFlow(["open", "slice", "--issue", "117", "--refs", "117"], f.deps)).toBe(2);
    expect(f.writes).toEqual([]);
    expect(f.out()).toBe("--issue and --refs cannot be used together: pick one");
  });

  test("the usage text names --refs (#839) and --title (#909)", async () => {
    const f = fake();
    expect(await prFlow(["open"], f.deps)).toBe(2);
    expect(f.out()).toContain("[--issue <n> | --refs <n>]");
    expect(f.out()).toContain("[--title <text>]");
  });

  test("#909: a --refs title is the first non-merge commit's subject without type(scope) and (#N); with none, the issue's", async () => {
    const title = async (subjects: string[]) => {
      const f = fake({
        pushed: ["slice"],
        subjects: { slice: subjects },
        issues: { 117: "A big issue" },
      });
      expect(await prFlow(["open", "slice", "--refs", "117"], f.deps)).toBe(0);
      return /-f title=(.*?) -f head=/.exec(f.writes[0] ?? "")?.[1];
    };
    // git log lists the newest first: the first commit is the last subject.
    expect(await title(["fix(slice): later (#9)", "docs: the first step"])).toBe(
      "the first step (#117)",
    );
    expect(await title(["Merge branch 'main' into slice", "feat(a-b): x y (#12)"])).toBe(
      "x y (#117)",
    );
    expect(await title(["refactor(slot)!: one lock", "Merge branch 'main' into slice"])).toBe(
      "one lock (#117)",
    );
    expect(await title(["Merge branch 'main' into slice"])).toBe("A big issue (#117)");
  });

  test("#909: --title overrides the title in every mode, and the issue still links", async () => {
    for (const mode of [["--refs", "117"], ["--issue", "117"], []]) {
      const f = fake({
        pushed: ["slice"],
        subjects: { slice: ["feat(slice): x (#117)"] },
        issues: { 117: "A big issue" },
      });
      expect(
        await prFlow(["open", "slice", ...mode, "--title", "Windows path fixes"], f.deps),
      ).toBe(0);
      expect(f.writes[0] ?? "").toContain("-f title=Windows path fixes (#117) -f head=");
    }
  });

  test("a new PR runs the FLIGHTDECK_PR_OPENED hook with its number, branch and base; a failed hook leaves the PR open (#273)", async () => {
    const setup = (hookCode: number) => {
      const f = fake({
        pushed: ["sec"],
        subjects: { sec: ["feat(sec): x (#273)"] },
        issues: { 273: "Reviews" },
        env: { FLIGHTDECK_PR_OPENED: "bun run oc-queue.ts --review" },
      });
      const ran: string[][] = [];
      const deps = {
        ...f.deps,
        run: async (command: string[]) => {
          ran.push(command);
          return { code: hookCode, stdout: "" };
        },
      };
      return { f, ran, deps };
    };
    const ok = setup(0);
    expect(await prFlow(["open", "sec", "--base", "ci-paths"], ok.deps)).toBe(0);
    expect(ok.ran).toEqual([["bun", "run", "oc-queue.ts", "--review", "300", "sec", "ci-paths"]]);
    const failed = setup(3);
    expect(await prFlow(["open", "sec"], failed.deps)).toBe(0);
    expect(failed.f.out()).toContain("FLIGHTDECK_PR_OPENED hook failed (exit 3); #300 is open");
  });

  test("a hook that cannot even start leaves the PR open too (#273)", async () => {
    const f = fake({
      pushed: ["sec"],
      subjects: { sec: ["feat(sec): x (#273)"] },
      issues: { 273: "Reviews" },
      env: { FLIGHTDECK_PR_OPENED: "no-such-program" },
    });
    const deps = {
      ...f.deps,
      run: async (): Promise<{ code: number; stdout: string }> => {
        throw new Error("ENOENT: no-such-program");
      },
    };
    expect(await prFlow(["open", "sec"], deps)).toBe(0);
    expect(f.out()).toContain(
      "FLIGHTDECK_PR_OPENED hook failed (ENOENT: no-such-program); #300 is open",
    );
  });

  test("a JSON array names a hook with spaces in its path; a failure never shows what it printed (#273)", async () => {
    const f = fake({
      pushed: ["sec"],
      subjects: { sec: ["feat(sec): x (#273)"] },
      issues: { 273: "Reviews" },
      env: { FLIGHTDECK_PR_OPENED: '["C:\\\\Program Files\\\\oc.exe", "--review"]' },
    });
    const ran: string[][] = [];
    const deps = {
      ...f.deps,
      run: async (command: string[]) => {
        ran.push(command);
        return { code: 2, stdout: "", stderr: "token ghp_secret" };
      },
    };
    expect(await prFlow(["open", "sec"], deps)).toBe(0);
    expect(ran).toEqual([["C:\\Program Files\\oc.exe", "--review", "300", "sec", "main"]]);
    expect(f.out()).toContain("FLIGHTDECK_PR_OPENED hook failed (exit 2); #300 is open");
    expect(f.out()).not.toContain("ghp_secret");
  });

  test("a hook value that starts like JSON but is not an array of strings runs nothing and says so (#273)", async () => {
    for (const value of ['["oc", 3]', '["oc"', "[]"]) {
      const f = fake({
        pushed: ["sec"],
        subjects: { sec: ["feat(sec): x (#273)"] },
        issues: { 273: "Reviews" },
        env: { FLIGHTDECK_PR_OPENED: value },
      });
      const ran: string[][] = [];
      const deps = {
        ...f.deps,
        run: async (command: string[]) => {
          ran.push(command);
          return { code: 0, stdout: "" };
        },
      };
      expect(await prFlow(["open", "sec"], deps)).toBe(0);
      expect(ran).toEqual([]);
      expect(f.out()).toContain(
        "FLIGHTDECK_PR_OPENED is not a JSON array of strings; #300 is open",
      );
    }
  });

  test("without FLIGHTDECK_PR_OPENED no hook runs (#273)", async () => {
    const f = fake({
      pushed: ["sec"],
      subjects: { sec: ["feat(sec): x (#273)"] },
      issues: { 273: "Reviews" },
    });
    const ran: string[][] = [];
    const deps = {
      ...f.deps,
      run: async (command: string[]) => {
        ran.push(command);
        return { code: 0, stdout: "" };
      },
    };
    expect(await prFlow(["open", "sec"], deps)).toBe(0);
    expect(ran).toEqual([]);
  });

  test("a branch that already has an open PR gets no second one", async () => {
    const f = fake({ pushed: ["a"], prs: [pr(12, "a")], subjects: { a: ["fix(a): x (#1)"] } });
    expect(await prFlow(["open", "a"], f.deps)).toBe(0);
    expect(f.writes).toEqual([]);
    expect(f.out()).toContain("a already has PR #12");
  });

  test("a branch not pushed, one whose commits name no issue, or an unreadable issue is refused", async () => {
    expect(await prFlow(["open", "local-only"], fake().deps)).toBe(2);
    const noIssue = fake({ pushed: ["b"], subjects: { b: ["docs: x"] } });
    expect(await prFlow(["open", "b"], noIssue.deps)).toBe(2);
    expect(noIssue.out()).toContain("--issue");
    const unknown = fake({ pushed: ["c"], subjects: { c: ["fix(c): x (#404)"] } });
    expect(await prFlow(["open", "c"], unknown.deps)).toBe(1);
    expect(unknown.out()).toContain("#404");
    const refused = fake({
      pushed: ["d"],
      subjects: { d: ["fix(d): x (#1)"] },
      issues: { 1: "One" },
      fail: /-X POST/,
    });
    expect(await prFlow(["open", "d"], refused.deps)).toBe(1);
  });
});

describe("pr-flow: next", () => {
  test("lists the open PRs in merge order with what each still needs; the ready ones first", async () => {
    const f = fake({
      prs: [
        pr(20, "b", { base: "a" }),
        pr(12, "a"),
        pr(13, "behind"),
        pr(14, "red"),
        pr(15, "running"),
        pr(16, "wip", { draft: true }),
        pr(17, "done"),
        pr(19, "conflicted", { mergeableState: "dirty" }),
      ],
      runs: {
        sha12: green(),
        sha20: green(),
        sha13: green(),
        sha14: green().map((r, i) => (i === 0 ? { ...r, conclusion: "failure" } : r)),
        sha15: green().map((r, i) => (i === 1 ? { ...r, status: "queued", conclusion: null } : r)),
        sha16: green(),
        sha17: green(),
        sha19: green(),
      },
      behind: { "main...behind": 3 },
    });
    expect(await prFlow(["next"], f.deps)).toBe(0);
    // Behind main is no reason to wait (#305: the ruleset is not strict); only a conflict is.
    expect(f.lines).toEqual([
      "ready to merge, in order:",
      "  #12 a",
      "  #13 behind",
      "  #17 done",
      "not ready:",
      // In merge order: a stacked PR right after the PR it sits on.
      "  #20 b: waits for #12 (a)",
      "  #14 red: failing: test (ubuntu-latest)",
      "  #15 running: running: test (windows-latest)",
      "  #16 wip: a draft",
      "  #19 conflicted: conflicts with main: merge main into conflicted and resolve them",
    ]);
  });

  test("without the ruleset's required checks it says so and fails", async () => {
    const f = fake({ fail: /rules\/branches/ });
    expect(await prFlow(["next"], f.deps)).toBe(1);
    expect(f.out()).toContain("required checks");
  });

  test("no open PR is said plainly", async () => {
    const f = fake();
    expect(await prFlow(["next"], f.deps)).toBe(0);
    expect(f.lines).toEqual(["no open PR"]);
  });
});

describe("pr-flow: update and merge", () => {
  test("update brings a PR up to date with its base by REST, then turns its auto-merge back on (#613)", async () => {
    const f = fake({ prs: [pr(13, "behind")] });
    expect(await prFlow(["update", "13"], f.deps)).toBe(0);
    // GitHub turns auto-merge off when a PR conflicts, and nothing turns it back on after the merge.
    expect(f.writes).toHaveLength(2);
    expect(f.writes[0]).toBe(`api -X PUT ${R}/pulls/13/update-branch`);
    expect(f.writes[1]).toContain("enablePullRequestAutoMerge");
    expect(f.writes[1]).toContain("-f id=PR_node13");
    expect(f.out()).toContain("#13 merges by itself");
    const refused = fake({ prs: [pr(13, "behind")], fail: /update-branch/ });
    expect(await prFlow(["update", "13"], refused.deps)).toBe(1);
    expect(refused.writes.filter((w) => w.includes("enablePullRequestAutoMerge"))).toEqual([]);
  });

  test("update waits like a push (#741): a young green PR run holds it, naming the run and the override", async () => {
    const now = Date.parse("2026-11-07T23:10:00Z");
    const run = (status: string, startedAt: string) =>
      JSON.stringify([
        { databaseId: 42, status, startedAt, url: "https://github.com/o/r/actions/runs/42" },
      ]);
    const young = {
      prs: [pr(13, "behind")],
      now,
      prRuns: { behind: run("in_progress", "2026-11-07T23:04:00Z") },
    };
    const held = fake(young);
    expect(await prFlow(["update", "13"], held.deps)).toBe(1);
    expect(held.writes).toEqual([]);
    expect(held.out()).toContain("CI run 42");
    expect(held.out()).toContain("6 min old");
    expect(held.out()).toContain('FLIGHTDECK_PUSH_NOW="<reason>" bun run pr -- update 13');
    expect(held.asked).toEqual([
      "run list --branch=behind --event=pull_request --limit=1 --json=databaseId,status,startedAt,url",
    ]);
    // The override with a reason, the coordinator, an old run or a failed check: the update goes.
    for (const f of [
      fake({ ...young, env: { FLIGHTDECK_PUSH_NOW: "the reviewer needs main in it" } }),
      fake({ ...young, env: { FLIGHTDECK_COORDINATOR: "1" } }),
      fake({ ...young, prRuns: { behind: run("in_progress", "2026-11-07T22:40:00Z") } }),
      fake({
        ...young,
        prViews: {
          13: JSON.stringify({
            mergeable: "MERGEABLE",
            statusCheckRollup: [{ conclusion: "FAILURE" }],
          }),
        },
      }),
    ]) {
      expect(await prFlow(["update", "13"], f.deps)).toBe(0);
      expect(f.writes[0]).toBe(`api -X PUT ${R}/pulls/13/update-branch`);
    }
    // A reason of fewer than 8 characters is no override.
    const short = fake({ ...young, env: { FLIGHTDECK_PUSH_NOW: "now" } });
    expect(await prFlow(["update", "13"], short.deps)).toBe(1);
  });

  test("update with GitHub unread asks once more, then holds, naming the override (#741)", async () => {
    const f = fake({ prs: [pr(13, "behind")], now: 0, prRuns: { behind: null } });
    expect(await prFlow(["update", "13"], f.deps)).toBe(1);
    expect(f.asked).toHaveLength(2);
    expect(f.writes).toEqual([]);
    expect(f.out()).toContain("GitHub could not be read");
    expect(f.out()).toContain('FLIGHTDECK_PUSH_NOW="<reason>" bun run pr -- update 13');
    // GitHub's answer that is not JSON reads as unread too, never a crash (#952 security review).
    const garbled = fake({ prs: [pr(13, "behind", { raw: "<html>" })], now: 0 });
    expect(await prFlow(["update", "13"], garbled.deps).catch(() => "crashed")).toBe(1);
    expect(garbled.out()).toContain("#13: GitHub could not be read");
    // A PR that cannot be read has no branch to ask about: held the same way, and no run is listed.
    const unread = fake({ prs: [], now: 0 });
    expect(await prFlow(["update", "99"], unread.deps)).toBe(1);
    expect(unread.asked).toEqual([]);
    expect(unread.out()).toContain("#99: GitHub could not be read");
  });

  test("a fork's PR holds without a lookup: a branch of the same name here is not its run (#952 security review)", async () => {
    for (const headRepo of ["someone/flightdeck", null]) {
      const f = fake({ prs: [pr(13, "behind", { headRepo })], now: 0 });
      expect(await prFlow(["update", "13"], f.deps)).toBe(1);
      expect(f.asked).toEqual([]);
      expect(f.writes).toEqual([]);
      expect(f.out()).toContain("#13 comes from a fork");
      expect(f.out()).toContain('FLIGHTDECK_PUSH_NOW="<reason>" bun run pr -- update 13');
    }
    const same = fake({ prs: [pr(13, "behind", { headRepo: "o/r" })], now: 0 });
    expect(await prFlow(["update", "13"], same.deps)).toBe(0);
  });

  test("a draft is updated and left without auto-merge, and that is no failure (#613)", async () => {
    const f = fake({ prs: [pr(14, "drafty", { draft: true })] });
    expect(await prFlow(["update", "14"], f.deps)).toBe(0);
    expect(f.writes).toEqual([`api -X PUT ${R}/pulls/14/update-branch`]);
    expect(f.out()).toContain("#14: auto-merge not turned on: a draft");
  });

  const COORDINATOR = { FLIGHTDECK_COORDINATOR: "1" };

  test("merge is the coordinator's only, and changes nothing otherwise", async () => {
    const f = fake({ prs: [pr(12, "a")], runs: { sha12: green() } });
    expect(await prFlow(["merge", "12"], f.deps)).toBe(2);
    expect(f.writes).toEqual([]);
    expect(f.out()).toContain("FLIGHTDECK_COORDINATOR");
  });

  test("a green, up-to-date PR onto main merges with a merge commit, pinned to its HEAD", async () => {
    const f = fake({ prs: [pr(12, "a")], runs: { sha12: green() }, env: COORDINATOR });
    expect(await prFlow(["merge", "12"], f.deps)).toBe(0);
    expect(f.writes).toEqual([`api -X PUT ${R}/pulls/12/merge -f merge_method=merge -f sha=sha12`]);
  });

  test("a draft, a stacked PR, red or pending checks, or a conflict with main is refused, by reason", async () => {
    const cases: [FakePr, CheckRun[], number, string][] = [
      [pr(16, "wip", { draft: true }), green(), 0, "a draft"],
      [pr(20, "b", { base: "a" }), green(), 0, "onto a, not main"],
      [
        pr(14, "red"),
        green().map((r, i) => (i === 0 ? { ...r, conclusion: "failure" } : r)),
        0,
        "failing: test (ubuntu-latest)",
      ],
      [pr(18, "none"), [], 0, "missing: test (ubuntu-latest)"],
      [pr(19, "conflicted", { mergeableState: "dirty" }), green(), 3, "conflicts with main"],
    ];
    for (const [p, runs, behind, reason] of cases) {
      const f = fake({
        prs: [p],
        runs: { [p.sha]: runs },
        behind: { [`main...${p.head}`]: behind },
        env: COORDINATOR,
      });
      expect(await prFlow(["merge", String(p.number)], f.deps)).toBe(2);
      expect(f.writes).toEqual([]);
      expect(f.out()).toContain(reason);
    }
  });

  test("a green PR behind main merges, with how far behind it is as a note (#305)", async () => {
    const f = fake({
      prs: [pr(13, "behind")],
      runs: { sha13: green() },
      behind: { "main...behind": 3 },
      env: COORDINATOR,
    });
    expect(await prFlow(["merge", "13"], f.deps)).toBe(0);
    expect(f.writes).toEqual([`api -X PUT ${R}/pulls/13/merge -f merge_method=merge -f sha=sha13`]);
    expect(f.out()).toContain(
      "#13 is 3 commit(s) behind main (merged anyway; main's push CI runs on the result)",
    );
  });

  test("a merge GitHub refuses, or a PR that cannot be read, fails with exit 1", async () => {
    const refused = fake({
      prs: [pr(12, "a")],
      runs: { sha12: green() },
      env: COORDINATOR,
      fail: /\/merge/,
    });
    expect(await prFlow(["merge", "12"], refused.deps)).toBe(1);
    expect(await prFlow(["merge", "99"], fake({ env: COORDINATOR }).deps)).toBe(1);
    const noRules = fake({ prs: [pr(12, "a")], env: COORDINATOR, fail: /rules\/branches/ });
    expect(await prFlow(["merge", "12"], noRules.deps)).toBe(1);
    expect(noRules.writes).toEqual([]);
  });

  test("auto turns on GitHub's auto-merge with a merge commit, by the PR's node id, for any session (#271)", async () => {
    const f = fake({ prs: [pr(12, "a")] });
    expect(await prFlow(["auto", "12"], f.deps)).toBe(0);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toContain("api -X POST graphql");
    expect(f.writes[0]).toContain("enablePullRequestAutoMerge");
    expect(f.writes[0]).toContain("mergeMethod: MERGE");
    expect(f.writes[0]).toContain("-f id=PR_node12");
    expect(f.out()).toContain("#12 merges by itself");
  });

  test("auto refuses a draft or a stacked PR, and writes nothing (#271)", async () => {
    for (const [p, reason] of [
      [pr(16, "wip", { draft: true }), "a draft"],
      [pr(20, "b", { base: "a" }), "onto a, which main does not have yet"],
    ] as const) {
      const f = fake({ prs: [p], behind: { "main...a": 2 } });
      expect(await prFlow(["auto", String(p.number)], f.deps)).toBe(2);
      expect(f.writes).toEqual([]);
      expect(f.out()).toContain(reason);
    }
  });

  test("auto retargets to main a stacked PR whose parent main already has, then turns it on (#271)", async () => {
    const f = fake({ prs: [pr(20, "b", { base: "a" })], behind: { "main...a": 0 } });
    expect(await prFlow(["auto", "20"], f.deps)).toBe(0);
    expect(f.writes[0]).toBe(`api -X PATCH ${R}/pulls/20 -f base=main`);
    expect(f.writes[1]).toContain("enablePullRequestAutoMerge");
    const refused = fake({
      prs: [pr(20, "b", { base: "a" })],
      behind: { "main...a": 0 },
      fail: /PATCH/,
    });
    expect(await prFlow(["auto", "20"], refused.deps)).toBe(1);
    expect(refused.writes.filter((w) => w.includes("graphql"))).toEqual([]);
  });

  test("auto never retargets a stacked PR when GitHub cannot compare its parent with main (#271)", async () => {
    const f = fake({ prs: [pr(20, "b", { base: "a" })], fail: /compare/ });
    expect(await prFlow(["auto", "20"], f.deps)).toBe(2);
    expect(f.writes).toEqual([]);
    expect(f.out()).toContain("cannot compare a with main");
  });

  test("auto that GitHub refuses fails with its reason; an unreadable PR fails too (#271)", async () => {
    const refused = fake({
      prs: [pr(12, "a")],
      graphqlError: "Pull request Auto merge is not allowed for this repository",
      runs: { sha12: green() },
    });
    expect(await prFlow(["auto", "12"], refused.deps)).toBe(1);
    expect(refused.out()).toContain("Auto merge is not allowed");
    expect(refused.writes.filter((w) => w.includes("/merge"))).toEqual([]);
    const silent = fake({ prs: [pr(12, "a")], fail: /graphql/ });
    expect(await prFlow(["auto", "12"], silent.deps)).toBe(1);
    expect(silent.out()).toContain("GitHub refused auto-merge for #12");
    expect(await prFlow(["auto", "99"], fake().deps)).toBe(1);
  });

  const CLEAN = "Pull request is in clean status";

  test("auto merges a PR GitHub calls clean, with every required check green, pinned to its head, as auto-merge would (#374)", async () => {
    const f = fake({ prs: [pr(12, "a")], graphqlError: CLEAN, runs: { sha12: green() } });
    expect(await prFlow(["auto", "12"], f.deps)).toBe(0);
    expect(f.writes).toHaveLength(2);
    expect(f.writes[0]).toContain("enablePullRequestAutoMerge");
    expect(f.writes[1]).toBe(`api -X PUT ${R}/pulls/12/merge -f merge_method=merge -f sha=sha12`);
    expect(f.out()).toContain("#12 is already mergeable: merging it as auto-merge would");
    expect(f.out()).toContain("#12 merged into main");
  });

  test("auto merges nothing after a clean refusal unless every required check is green on the head (#374)", async () => {
    const failing = green().map((r, i) => (i === 0 ? { ...r, conclusion: "failure" } : r));
    const running = green().map((r, i) => (i === 1 ? { ...r, status: "in_progress" } : r));
    for (const [runs, reason] of [
      [failing, "failing: test (ubuntu-latest)"],
      [running, "running: test (windows-latest)"],
      [[], "missing: test (ubuntu-latest)"],
    ] as const) {
      const f = fake({ prs: [pr(12, "a")], graphqlError: CLEAN, runs: { sha12: [...runs] } });
      expect(await prFlow(["auto", "12"], f.deps)).toBe(2);
      expect(f.writes.filter((w) => w.includes("/merge"))).toEqual([]);
      expect(f.out()).toContain(`#12 not merged: ${reason}`);
    }
  });

  test("auto merges nothing after a clean refusal when GitHub's state is no longer clean (#374)", async () => {
    for (const state of ["unknown", "unstable", "blocked", "behind", "dirty"]) {
      const f = fake({
        prs: [pr(12, "a", { mergeableState: state })],
        graphqlError: CLEAN,
        runs: { sha12: green() },
      });
      expect(await prFlow(["auto", "12"], f.deps)).toBe(2);
      expect(f.writes.filter((w) => w.includes("/merge"))).toEqual([]);
      expect(f.out()).toContain(`#12 not merged: GitHub says ${state}, not clean`);
    }
  });

  test("auto merges nothing after a clean refusal when the ruleset cannot be read, and reports a refused merge (#374)", async () => {
    const rules = fake({
      prs: [pr(12, "a")],
      graphqlError: CLEAN,
      runs: { sha12: green() },
      fail: /rules\/branches/,
    });
    expect(await prFlow(["auto", "12"], rules.deps)).toBe(1);
    expect(rules.writes.filter((w) => w.includes("/merge"))).toEqual([]);
    expect(rules.out()).toContain("required checks cannot be read");

    const refused = fake({
      prs: [pr(12, "a")],
      graphqlError: CLEAN,
      runs: { sha12: green() },
      fail: /pulls\/12\/merge/,
    });
    expect(await prFlow(["auto", "12"], refused.deps)).toBe(1);
    expect(refused.out()).toContain("GitHub refused to merge #12");
  });

  test("an unknown command or a missing argument is the usage, exit 2", async () => {
    for (const argv of [[], ["nope"], ["open"], ["update"], ["merge", "x"], ["auto"]]) {
      const f = fake();
      expect(await prFlow(argv, f.deps)).toBe(2);
      expect(f.out()).toContain("usage: bun run pr --");
    }
  });
});

describe("pr-flow: the CI of a commit and the release tag (#266)", () => {
  test("a commit's required checks read as 0, failed, pending or none", async () => {
    const failing = green().map((r, i) => (i === 0 ? { ...r, conclusion: "failure" } : r));
    const running = green().map((r, i) =>
      i === 1 ? { ...r, status: "queued", conclusion: null } : r,
    );
    const f = fake({ runs: { ok1: green(), red1: failing, run1: running } });
    expect(await headCi("ok1", f.deps)).toBe("0");
    expect(await headCi("red1", f.deps)).toBe("failed");
    expect(await headCi("run1", f.deps)).toBe("pending");
    expect(await headCi("none1", f.deps)).toBe("none");
    expect(await headCi("ok1", fake({ fail: /rules\/branches/ }).deps)).toBe("unknown");
  });

  const COORDINATOR = { FLIGHTDECK_COORDINATOR: "1" };
  // A full run: the schedule's (every 3 hours, #444). A push to main runs a partial one.
  const released = { id: 1, event: "schedule", status: "completed", conclusion: "success" };
  const pushGreen = { id: 2, event: "push", status: "completed", conclusion: "success" };
  const START = "workflow run ci.yml --ref main -f only=all";

  test("tag tags main's HEAD after a green full run of it on main, and pushes the tag alone", async () => {
    const f = fake({
      env: COORDINATOR,
      mainHead: "abc123",
      onMain: ["abc123"],
      mainRuns: { abc123: [released] },
    });
    expect(await prFlow(["tag", "v0.36.5"], f.deps)).toBe(0);
    expect(f.gitWrites).toEqual([
      "tag -a v0.36.5 -m v0.36.5 abc123",
      "push origin refs/tags/v0.36.5",
    ]);
    expect(f.out()).toContain("v0.36.5 tagged on abc123");
  });

  test("tag refuses, and writes nothing, without the coordinator, a green full run, or a free tag on main", async () => {
    const base = { mainHead: "abc123", onMain: ["abc123"], mainRuns: { abc123: [released] } };
    const cases: [Parameters<typeof fake>[0], string[], string][] = [
      [{ ...base }, ["tag", "v0.36.5"], "FLIGHTDECK_COORDINATOR"],
      [{ ...base, env: COORDINATOR }, ["tag", "0.36.5"], "usage: bun run pr --"],
      [
        { ...base, env: COORDINATOR, tags: ["v0.36.5"] },
        ["tag", "v0.36.5"],
        "v0.36.5 exists already",
      ],
      [
        { ...base, env: COORDINATOR },
        ["tag", "v0.36.5", "--commit", "feat9"],
        "feat9 is not on main",
      ],
      [
        { ...base, env: COORDINATOR, mainRuns: {} },
        ["tag", "v0.36.5", "--commit", "abc123"],
        "no full green run of abc123 on main",
      ],
      [
        { ...base, env: COORDINATOR, mainRuns: { abc123: [pushGreen] } },
        ["tag", "v0.36.5", "--commit", "abc123"],
        "abc123 has no full green run on main",
      ],
      [
        {
          ...base,
          env: COORDINATOR,
          mainRuns: { abc123: [{ status: "in_progress", conclusion: null }] },
        },
        ["tag", "v0.36.5"],
        "abc123's CI run on main is still running",
      ],
      [
        {
          ...base,
          env: COORDINATOR,
          mainRuns: { abc123: [{ status: "completed", conclusion: "failure" }] },
        },
        ["tag", "v0.36.5"],
        "abc123's CI run on main did not pass",
      ],
      [{ env: COORDINATOR }, ["tag", "v0.36.5"], "origin/main cannot be read"],
    ];
    for (const [opts, argv, reason] of cases) {
      const f = fake(opts);
      expect(await prFlow(argv, f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.out()).toContain(reason);
    }
  });

  describe("when main's HEAD has no green run because a later merge cancelled it (#376)", () => {
    const cancelled = { status: "completed", conclusion: "cancelled" };
    const stacked = {
      env: COORDINATOR,
      mainHead: "head3",
      onMain: ["head3", "bump2", "old1"],
      history: ["head3", "bump2", "old1"],
      versions: { head3: "0.37.0", bump2: "0.37.0", old1: "0.36.9" },
    };

    test("tag takes the newest commit that has the bump and a green run, and says so", async () => {
      const f = fake({
        ...stacked,
        mainRuns: { head3: [cancelled], bump2: [released], old1: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(0);
      expect(f.gitWrites).toEqual([
        "tag -a v0.37.0 -m v0.37.0 bump2",
        "push origin refs/tags/v0.37.0",
      ]);
      expect(f.out()).toContain("head3 has no full green run on main");
      expect(f.out()).toContain("v0.37.0 tagged on bump2");
    });

    test("a commit from before the bump is never taken, and nothing is written", async () => {
      const f = fake({
        ...stacked,
        mainRuns: { head3: [cancelled], bump2: [cancelled], old1: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.out()).toContain("no commit with the v0.37.0 bump has one");
    });

    test("a history that is all bump and has no green run refuses", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "bump2"],
        mainRuns: { head3: [cancelled], bump2: [cancelled] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
    });

    test("a commit whose package.json cannot be read ends the search", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "unread4", "bump2"],
        mainRuns: { head3: [cancelled], bump2: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
    });

    test("a run that failed is not skipped over, and --commit asks for exactly that commit", async () => {
      const failed = { status: "completed", conclusion: "failure" };
      const f = fake({ ...stacked, mainRuns: { head3: [failed], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("did not pass");
      expect(f.gitWrites).toEqual([]);
      const pinned = fake({ ...stacked, mainRuns: { head3: [cancelled], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0", "--commit", "head3"], pinned.deps)).toBe(2);
      expect(pinned.gitWrites).toEqual([]);
    });

    // On a busy main HEAD's push run is queued or going when the release is cut (#529).
    for (const [state, run] of [
      ["in progress", { status: "in_progress", conclusion: null }],
      ["queued", { status: "queued", conclusion: null }],
    ] as const) {
      test(`a HEAD run that is ${state} has not failed: tag takes the newest commit with the bump and a full green run, and says which`, async () => {
        const f = fake({
          ...stacked,
          mainRuns: { head3: [run], bump2: [released], old1: [released] },
        });
        expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(0);
        expect(f.gitWrites).toEqual([
          "tag -a v0.37.0 -m v0.37.0 bump2",
          "push origin refs/tags/v0.37.0",
        ]);
        expect(f.out()).toContain("head3's CI run on main is still running: tagging bump2");
        expect(f.writes).toEqual([]);
      });
    }

    test("a HEAD run still going next to one that failed is a failure: nothing is skipped over", async () => {
      const f = fake({
        ...stacked,
        mainRuns: {
          head3: [
            { status: "in_progress", conclusion: null },
            { status: "completed", conclusion: "failure" },
          ],
          bump2: [released],
        },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("did not pass");
      expect(f.gitWrites).toEqual([]);
    });

    // HEAD has the bump and no bump commit has a full green run: the full run starts at once, in its own
    // concurrency group, instead of after HEAD's push run settles (#545).
    const waiting = {
      ...stacked,
      history: ["head3", "bump2"],
    };

    test("a HEAD run still going and no earlier green commit: a full run starts at once, tag waits for it and tags nothing", async () => {
      const f = fake({
        ...waiting,
        mainRuns: { head3: [{ status: "queued", conclusion: null }], bump2: [pushGreen] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("head3's CI run on main is still running");
      expect(f.out()).toContain(
        "a full run of main was started; run pr tag again when it is green",
      );
      expect(f.gitWrites).toEqual([]);
      expect(f.writes).toEqual([START]);
    });

    test("a dispatch of that commit that is queued or going is not started twice", async () => {
      for (const status of ["queued", "in_progress"]) {
        const f = fake({
          ...waiting,
          mainRuns: {
            head3: [
              { id: 5, event: "push", status: "in_progress", conclusion: null },
              { id: 6, event: "workflow_dispatch", status, conclusion: null },
            ],
            bump2: [pushGreen],
          },
        });
        expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
        expect(f.out()).toContain(
          "a full run of main is already going; run pr tag again when it is green",
        );
        expect(f.writes).toEqual([]);
        expect(f.gitWrites).toEqual([]);
      }
    });

    test("a dispatch that already finished does not stop a new one while the push run is going", async () => {
      const f = fake({
        ...waiting,
        mainRuns: {
          head3: [
            { id: 5, event: "push", status: "in_progress", conclusion: null },
            { id: 6, event: "workflow_dispatch", status: "completed", conclusion: "cancelled" },
          ],
          bump2: [pushGreen],
        },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.writes).toEqual([START]);
    });

    test("when GitHub refuses the dispatch of a commit whose run is going, it says how to start one by hand", async () => {
      const f = fake({
        ...waiting,
        mainRuns: { head3: [{ status: "queued", conclusion: null }], bump2: [pushGreen] },
        fail: /^workflow run/,
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("still running");
      expect(f.out()).toContain("start one (gh workflow run ci.yml --ref main -f only=all)");
      expect(f.gitWrites).toEqual([]);
    });

    test("--commit pins a commit whose run is still going: it refuses, and falls back to nothing", async () => {
      const f = fake({
        ...stacked,
        mainRuns: { head3: [{ status: "in_progress", conclusion: null }], bump2: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0", "--commit", "head3"], f.deps)).toBe(2);
      expect(f.out()).toContain("still running");
      expect(f.gitWrites).toEqual([]);
    });
  });

  describe("the gate is a full green run (#444): a push to main runs only a partial one", () => {
    const stacked = {
      env: COORDINATOR,
      mainHead: "head3",
      onMain: ["head3", "bump2", "old1"],
      history: ["head3", "bump2", "old1"],
      versions: { head3: "0.37.0", bump2: "0.37.0", old1: "0.36.9" },
    };

    test("a green push run is no full run: tag takes the newest commit with the bump and a full green run", async () => {
      const f = fake({ ...stacked, mainRuns: { head3: [pushGreen], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(0);
      expect(f.gitWrites).toEqual([
        "tag -a v0.37.0 -m v0.37.0 bump2",
        "push origin refs/tags/v0.37.0",
      ]);
      expect(f.out()).toContain("head3 has no full green run on main");
    });

    test("a dispatch counts as a full run only when its test suite ran and passed", async () => {
      const full = {
        id: 7,
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
      };
      const screens = {
        id: 8,
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
      };
      const runJobs = {
        // Windows is a signal in a full run, never a gate (#534): a red shard does not block the tag.
        7: [
          { name: "test suite (ubuntu-latest) (dispatch)", conclusion: "success" },
          { name: "test shard 1/3 (windows-latest) (dispatch)", conclusion: "failure" },
        ],
        8: [{ name: "test suite (ubuntu-latest) (dispatch)", conclusion: "skipped" }],
      };
      const ok = fake({ ...stacked, mainRuns: { head3: [full] }, runJobs });
      expect(await prFlow(["tag", "v0.37.0"], ok.deps)).toBe(0);
      expect(ok.gitWrites[0]).toBe("tag -a v0.37.0 -m v0.37.0 head3");
      const partial = fake({ ...stacked, mainRuns: { head3: [screens] }, runJobs });
      expect(await prFlow(["tag", "v0.37.0"], partial.deps)).toBe(2);
      expect(partial.gitWrites).toEqual([]);
    });

    test("with no full green run to tag, it starts one on main, asks to run it again, and tags nothing", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "bump2"],
        mainRuns: { head3: [pushGreen], bump2: [pushGreen] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.writes).toEqual([START]);
      expect(f.out()).toContain(
        "a full run of main was started; run pr tag again when it is green",
      );
    });

    test("when GitHub refuses to start the full run, it says how to start one by hand", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "bump2"],
        mainRuns: { head3: [pushGreen], bump2: [pushGreen] },
        fail: /^workflow run/,
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.out()).toContain("start one (gh workflow run ci.yml --ref main -f only=all)");
    });

    test("a failed partial run on HEAD is never skipped over, and nothing is started", async () => {
      const failed = { id: 3, event: "push", status: "completed", conclusion: "failure" };
      const f = fake({ ...stacked, mainRuns: { head3: [failed], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("did not pass");
      expect(f.gitWrites).toEqual([]);
      expect(f.writes).toEqual([]);
    });
  });

  test("a tag git refuses to make or push fails with exit 1", async () => {
    const ready = {
      env: { FLIGHTDECK_COORDINATOR: "1" },
      mainHead: "abc123",
      onMain: ["abc123"],
      mainRuns: { abc123: [released] },
    };
    const pushRefused = fake({ ...ready, fail: /^push/ });
    expect(await prFlow(["tag", "v0.36.5"], pushRefused.deps)).toBe(1);
    expect(pushRefused.out()).toContain("the push of v0.36.5 failed");
    const tagRefused = fake({ ...ready, fail: /^tag -a/ });
    expect(await prFlow(["tag", "v0.36.5"], tagRefused.deps)).toBe(1);
    expect(tagRefused.out()).toContain("git refused to make v0.36.5");
    expect(tagRefused.gitWrites).toEqual(["tag -a v0.36.5 -m v0.36.5 abc123"]);
  });
});

describe("pr-flow: where the release tag reads the product version (#559)", () => {
  test("the file greenWithBump reads holds a version in this repo", () => {
    const root = join(import.meta.dir, "..", "..");
    const version = (file: string) =>
      (JSON.parse(readFileSync(join(root, file), "utf8")) as { version?: unknown }).version;
    expect(typeof version(VERSION_FILE)).toBe("string");
  });
});
