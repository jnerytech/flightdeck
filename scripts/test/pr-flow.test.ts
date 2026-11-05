import { describe, expect, test } from "bun:test";
import {
  type CheckRun,
  checksVerdict,
  issueOf,
  mergeOrder,
  type Pr,
  type PrFlowDeps,
  prFlow,
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
    /** The message GitHub's GraphQL answers with when it refuses. */
    graphqlError?: string;
  } = {},
) {
  const prs = opts.prs ?? [];
  const writes: string[] = [];
  const lines: string[] = [];
  const ok = (stdout: string) => ({ code: 0, stdout });
  const deps: PrFlowDeps = {
    gh: async (args) => {
      const line = args.join(" ");
      if (opts.fail?.test(line)) return { code: 1, stdout: "" };
      if (args.includes("-X")) writes.push(line);
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
        return ok(
          JSON.stringify({
            number: pr.number,
            node_id: `PR_node${pr.number}`,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            head: { ref: pr.head, sha: pr.sha },
            base: { ref: pr.base },
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
      return { code: 1, stdout: "" };
    },
    git: async (args) => {
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
  };
  return { deps, writes, lines, out: () => lines.join("\n") };
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
      ],
      runs: {
        sha12: green(),
        sha20: green(),
        sha13: green(),
        sha14: green().map((r, i) => (i === 0 ? { ...r, conclusion: "failure" } : r)),
        sha15: green().map((r, i) => (i === 1 ? { ...r, status: "queued", conclusion: null } : r)),
        sha16: green(),
        sha17: green(),
      },
      behind: { "main...behind": 3 },
    });
    expect(await prFlow(["next"], f.deps)).toBe(0);
    expect(f.lines).toEqual([
      "ready to merge, in order:",
      "  #12 a",
      "  #17 done",
      "not ready:",
      // In merge order: a stacked PR right after the PR it sits on.
      "  #20 b: waits for #12 (a)",
      "  #13 behind: 3 commit(s) behind main (bun run pr -- update 13)",
      "  #14 red: failing: test (ubuntu-latest)",
      "  #15 running: running: test (windows-latest)",
      "  #16 wip: a draft",
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
  test("update brings a PR up to date with its base by REST", async () => {
    const f = fake({ prs: [pr(13, "behind")] });
    expect(await prFlow(["update", "13"], f.deps)).toBe(0);
    expect(f.writes).toEqual([`api -X PUT ${R}/pulls/13/update-branch`]);
    const refused = fake({ prs: [pr(13, "behind")], fail: /update-branch/ });
    expect(await prFlow(["update", "13"], refused.deps)).toBe(1);
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

  test("a draft, a stacked PR, red or pending checks, or a PR behind main is refused, by reason", async () => {
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
      [pr(13, "behind"), green(), 3, "3 commit(s) behind main"],
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
    const refused = fake({ prs: [pr(12, "a")], graphqlError: "Pull request is in clean status" });
    expect(await prFlow(["auto", "12"], refused.deps)).toBe(1);
    expect(refused.out()).toContain("Pull request is in clean status");
    const silent = fake({ prs: [pr(12, "a")], fail: /graphql/ });
    expect(await prFlow(["auto", "12"], silent.deps)).toBe(1);
    expect(silent.out()).toContain("GitHub refused auto-merge for #12");
    expect(await prFlow(["auto", "99"], fake().deps)).toBe(1);
  });

  test("an unknown command or a missing argument is the usage, exit 2", async () => {
    for (const argv of [[], ["nope"], ["open"], ["update"], ["merge", "x"], ["auto"]]) {
      const f = fake();
      expect(await prFlow(argv, f.deps)).toBe(2);
      expect(f.out()).toContain("usage: bun run pr --");
    }
  });
});
