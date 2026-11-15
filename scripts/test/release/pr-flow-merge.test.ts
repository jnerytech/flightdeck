import { describe, expect, test } from "bun:test";
import { type CheckRun, prFlow } from "../../lib/pr/pr-flow.ts";
import { type FakePr, fake, green, pr, R } from "./pr-flow-setup.ts";

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

  test("a --now left on auto is said to be no longer needed, and auto runs as without it (#1697)", async () => {
    const f = fake({ prs: [pr(12, "a")], graphqlError: CLEAN, runs: { sha12: green() } });
    const code = await prFlow(["auto", "12", "--now"], f.deps);
    expect([code, f.writes.filter((w) => w.includes("/merge")).length, f.lines[0]]).toEqual([
      0,
      1,
      "--now is no longer needed: pr auto does not wait for a review (#1697)",
    ]);
  });

  test("an unknown command or a missing argument is the usage, exit 2", async () => {
    for (const argv of [[], ["nope"], ["open"], ["update"], ["merge", "x"], ["auto"]]) {
      const f = fake();
      expect(await prFlow(argv, f.deps)).toBe(2);
      expect(f.out()).toContain("usage: bun run pr --");
    }
  });
});
