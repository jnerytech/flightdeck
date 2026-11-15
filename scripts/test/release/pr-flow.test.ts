import { describe, expect, test } from "bun:test";
import {
  type CheckRun,
  checksVerdict,
  issueOf,
  issuesOf,
  mergeOrder,
  prFlow,
} from "../../lib/pr/pr-flow.ts";
import { fake, green, pr, REQUIRED } from "./pr-flow-setup.ts";

describe("pr-flow: the pure parts", () => {
  test("a branch's issue is the one its subjects name most; a tie goes to the first named", () => {
    expect(issueOf(["fix(a): x (#12)", "test(a): y (#12)", "docs: z (#9)"])).toBe(12);
    expect(issueOf(["feat(a): x (#7, #8)", "fix(a): y (#8)"])).toBe(8);
    expect(issueOf(["test(a): x (#5)", "fix(a): y (#6)"])).toBe(5);
    expect(issueOf(["docs: nothing here", "chore: #3 without parentheses"])).toBeNull();
  });

  test("a branch ships every issue its feat and fix subjects name, once, the oldest commit's first (#2442)", () => {
    expect(
      issuesOf([
        "feat(b): y (#8)",
        "test(b): y (#8)",
        "fix(a): x (#7)",
        "test(a): x (#7)",
        "docs: z (#3)",
      ]),
    ).toEqual([7, 8]);
    expect(issuesOf(["feat(a): x (#7, #8)", "fix: y (#8)", "feat(a)!: z (#9)"])).toEqual([9, 8, 7]);
    expect(issuesOf(["fix(a): y (#4)", "fix(a): x (#4)"])).toEqual([4]);
  });

  test("with no feat or fix naming an issue, the branch's own issue; with no issue at all, none (#2442)", () => {
    expect(issuesOf(["test(a): x (#5)", "docs: y (#5)", "docs: z (#6)"])).toEqual([5]);
    expect(issuesOf(["feat(a): x", "docs: nothing here"])).toEqual([]);
    expect(issuesOf([])).toEqual([]);
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

describe("pr-flow: a red main is said before a PR moves (#1246)", () => {
  const RED =
    "main is red since https://github.com/o/r/actions/runs/7: typecheck (#30, fd-qa); do not start a parallel fix";

  test("open and update print the red main's line with its claim and still do their work; green or a failed check says nothing", async () => {
    const opened = fake({
      pushed: ["oom-guard"],
      subjects: { "oom-guard": ["fix(oom-guard): x (#247)", "test(oom-guard): y (#247)"] },
      issues: { 247: "OOM on the Pi kills Claude sessions" },
    });
    opened.deps.mainRed = async () => RED;
    expect(await prFlow(["open", "oom-guard"], opened.deps)).toBe(0);
    expect(opened.out()).toContain(`warning: ${RED}`);
    expect(opened.writes).toHaveLength(1);
    const updated = fake({ prs: [pr(13, "behind")] });
    updated.deps.mainRed = async () => RED;
    expect(await prFlow(["update", "13"], updated.deps)).toBe(0);
    expect(updated.out()).toContain(`warning: ${RED}`);
    // A green main, or a check that fails, prints nothing and blocks nothing.
    const green = fake({ prs: [pr(13, "behind")] });
    green.deps.mainRed = async () => null;
    const broken = fake({ prs: [pr(13, "behind")] });
    broken.deps.mainRed = async () => {
      throw new Error("gh missing");
    };
    expect([
      await prFlow(["update", "13"], green.deps),
      await prFlow(["update", "13"], broken.deps),
    ]).toEqual([0, 0]);
    expect([green.out().includes("warning: main"), broken.out().includes("warning: main")]).toEqual(
      [false, false],
    );
  });
});
