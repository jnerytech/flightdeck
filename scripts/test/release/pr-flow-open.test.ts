import { describe, expect, test } from "bun:test";
import { prFlow } from "../../lib/pr/pr-flow.ts";
import { fake, pr, R } from "./pr-flow-setup.ts";

describe("pr-flow: open checks the review record (#1707)", () => {
  const open = (opts: Parameters<typeof fake>[0] = {}) =>
    fake({
      pushed: ["rev"],
      subjects: { rev: ["feat(rev): x (#9)"] },
      issues: { 9: "A change" },
      ...opts,
    });

  test("a branch whose head has a record of both reviews opens", async () => {
    const f = open();
    expect(await prFlow(["open", "rev"], f.deps)).toBe(0);
    expect(f.writes).toHaveLength(1);
  });

  test("a branch with no record is refused, and the message says which review is missing", async () => {
    const none = open({ review: { code: "", security: "" } });
    expect(await prFlow(["open", "rev"], none.deps)).toBe(1);
    expect(none.writes).toEqual([]);
    expect(none.out()).toContain("/code-review");
    expect(none.out()).toContain("/security-review");
    const half = open({ review: { code: "abc1234 ran", security: "" } });
    expect(await prFlow(["open", "rev"], half.deps)).toBe(1);
    expect(half.out()).toContain("missing /security-review");
    expect(half.out()).not.toContain("missing /code-review");
    expect(half.out()).toContain("--trailer");
  });

  test("a record that names an older head is refused: a later commit asks for a new review", async () => {
    const f = open({ trees: { abc1234: "older" } });
    expect(await prFlow(["open", "rev"], f.deps)).toBe(1);
    expect(f.writes).toEqual([]);
    expect(f.out()).toContain("missing /code-review and /security-review");
  });

  test("a name that is no commit (a tree sha) or not a sha never counts, and never reaches git as an option", async () => {
    const tree = open({ trees: { abc1234: "" } });
    expect(await prFlow(["open", "rev"], tree.deps)).toBe(1);
    const odd = open({ review: { code: "--output=x ran", security: "abc1234 ran" } });
    expect(await prFlow(["open", "rev"], odd.deps)).toBe(1);
    expect(odd.out()).toContain("missing /code-review");
    expect(odd.out()).not.toContain("missing /code-review and");
  });

  test("the coordinator's rc branch needs no record, and a worker's FLIGHTDECK_COORDINATOR=1 does not skip it", async () => {
    const rc = open({
      pushed: ["rc/1.2"],
      subjects: { "rc/1.2": ["chore(release): rc (#9)"] },
      review: { code: "", security: "" },
    });
    expect(await prFlow(["open", "rc/1.2"], rc.deps)).toBe(0);
    const worker = open({
      review: { code: "", security: "" },
      env: { FLIGHTDECK_COORDINATOR: "1" },
    });
    expect(await prFlow(["open", "rev"], worker.deps)).toBe(1);
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

  test("#2442: --issue a,b,c closes each issue on its own line and is titled after the first (#2442)", async () => {
    const f = fake({
      pushed: ["batch"],
      subjects: { batch: ["feat(x): z (#119)", "fix(x): y (#118)", "fix(x): x (#117)"] },
      issues: { 117: "First bug", 118: "Second bug", 119: "Third bug" },
    });
    expect(await prFlow(["open", "batch", "--issue", "117,118,119"], f.deps)).toBe(0);
    const post = f.writes[0] ?? "";
    expect(post).toContain("-f title=First bug (#117)");
    expect(post).toContain(
      "-f body=Closes #117\nCloses #118\nCloses #119\n\n- feat(x): z (#119)\n- fix(x): y (#118)\n- fix(x): x (#117)",
    );
  });

  test("#2442: --title names a batch, a repeated issue is listed once, and every issue must be readable", async () => {
    const f = fake({
      pushed: ["batch"],
      subjects: { batch: ["fix(x): x (#117)"] },
      issues: { 117: "First bug", 118: "Second bug" },
    });
    expect(
      await prFlow(["open", "batch", "--issue", "117,118,117", "--title", "Both bugs"], f.deps),
    ).toBe(0);
    const post = f.writes[0] ?? "";
    expect(post).toContain("-f title=Both bugs (#117)");
    expect(post).toContain("-f body=Closes #117\nCloses #118\n\n- fix(x): x (#117)");
    expect(post.match(/Closes #/g)).toHaveLength(2);
    const missing = fake({
      pushed: ["batch"],
      subjects: { batch: ["fix(x): x (#117)"] },
      issues: { 117: "First bug" },
    });
    expect(await prFlow(["open", "batch", "--issue", "117,999"], missing.deps)).toBe(1);
    expect(missing.writes).toEqual([]);
    expect(missing.out()).toContain("#999");
  });

  test("#2442: --issue takes issue numbers only, and --refs stays one issue", async () => {
    for (const bad of ["117,abc", "117,", ",117", "0", "117;118", ""]) {
      const f = fake({
        pushed: ["batch"],
        subjects: { batch: ["fix(x): x (#117)"] },
        issues: { 117: "First bug" },
      });
      expect(await prFlow(["open", "batch", "--issue", bad], f.deps), bad).toBe(2);
      expect(f.writes, bad).toEqual([]);
      expect(f.out(), bad).toContain("--issue takes issue numbers");
    }
    const noValue = fake({
      pushed: ["batch"],
      subjects: { batch: ["fix(x): x (#117)"] },
      issues: { 117: "First bug" },
    });
    expect(await prFlow(["open", "batch", "--issue"], noValue.deps)).toBe(2);
    expect(noValue.writes).toEqual([]);
    expect(noValue.out()).toContain("--issue takes issue numbers");
    const refs = fake({
      pushed: ["batch"],
      subjects: { batch: ["fix(x): x (#117)"] },
      issues: { 117: "First bug", 118: "Second bug" },
    });
    expect(await prFlow(["open", "batch", "--refs", "117,118"], refs.deps)).toBe(2);
    expect(refs.writes).toEqual([]);
    expect(refs.out()).toContain("--refs takes one issue");
  });

  test("#2442: with no --issue, every issue the feat and fix subjects name is closed, the oldest commit's first", async () => {
    const f = fake({
      pushed: ["batch"],
      subjects: {
        batch: ["feat(y): b (#118)", "test(y): b (#118)", "fix(x): a (#117)", "test(x): a (#117)"],
      },
      issues: { 117: "First bug", 118: "Second feature" },
    });
    expect(await prFlow(["open", "batch"], f.deps)).toBe(0);
    const post = f.writes[0] ?? "";
    expect(post).toContain("-f title=First bug (#117)");
    expect(post).toContain("-f body=Closes #117\nCloses #118\n\n- feat(y): b (#118)");
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
    expect(f.out()).toContain("[--issue <n[,n...]> | --refs <n>]");
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

  test("#2157: a branch that merged main is titled, listed and linked by its own first-parent commits only", async () => {
    const open = async (subjects: string[], mergedIn: string[], args: string[]) => {
      const f = fake({
        pushed: ["slice"],
        subjects: { slice: subjects },
        mergedIn: { slice: mergedIn },
        issues: { 117: "A big issue", 2094: "The modules" },
      });
      expect(await prFlow(["open", "slice", ...args], f.deps)).toBe(0);
      const post = f.writes[0] ?? "";
      return {
        title: /-f title=(.*?) -f head=/.exec(post)?.[1],
        body: /-f body=([\s\S]*?) -F draft=/.exec(post)?.[1],
      };
    };
    const merge = "Merge remote-tracking branch 'origin/main' into slice";
    const other = ["feat(y): other work (#1593)", "feat(z): more other work (#1593)"];
    expect(await open([merge, "refactor(x): own work (#2094)"], other, ["--refs", "117"])).toEqual({
      title: "own work (#117)",
      body: "Refs #117\n\n- refactor(x): own work (#2094)",
    });
    expect(
      await open(["test(x): second (#2094)", merge, "refactor(x): first (#2094)"], other, [
        "--refs",
        "117",
      ]),
    ).toEqual({
      title: "first (#117)",
      body: "Refs #117\n\n- test(x): second (#2094)\n- refactor(x): first (#2094)",
    });
    expect(await open([merge], other, ["--refs", "117"])).toEqual({
      title: "A big issue (#117)",
      body: "Refs #117\n",
    });
    // Without --issue or --refs the issue is the own commits' one, not the merged-in ones'.
    expect(
      (await open([merge, "refactor(x): own work (#2094)"], [...other, ...other], [])).title,
    ).toBe("The modules (#2094)");
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

  test("#1115: when GitHub ignores the head filter, another branch's PR is never taken as this one's", async () => {
    const f = fake({
      pushed: ["repo-wide"],
      prs: [pr(1113, "q1110-windows-tests"), pr(1111, "new-doc-label")],
      subjects: { "repo-wide": ["feat(repo-wide): x (#1108)"] },
      ignoreHead: true,
    });
    expect(await prFlow(["open", "repo-wide"], f.deps)).toBe(1);
    expect(f.writes).toEqual([]);
    expect(f.out()).not.toContain("already has PR");
    expect(f.out()).toContain("#1113 (q1110-windows-tests), #1111 (new-doc-label)");
    expect(f.out()).toContain("not repo-wide");
  });

  test("#1115: the branch's own PR is found among others GitHub lists", async () => {
    const f = fake({
      pushed: ["a"],
      prs: [pr(13, "b"), pr(12, "a")],
      subjects: { a: ["fix(a): x (#1)"] },
      ignoreHead: true,
    });
    expect(await prFlow(["open", "a"], f.deps)).toBe(0);
    expect(f.writes).toEqual([]);
    expect(f.out()).toMatch(/^a already has PR #12$/m);
  });

  test("#1124 review: a fork's PR on a branch of the same name, or a longer name, is not the branch's own", async () => {
    for (const listed of [pr(14, "a", { headRepo: "someone/fork" }), pr(15, "a-2")]) {
      const f = fake({
        pushed: ["a"],
        prs: [listed],
        subjects: { a: ["fix(a): x (#1)"] },
        ignoreHead: true,
      });
      expect(`#${listed.number}: ${await prFlow(["open", "a"], f.deps)} ${f.writes.length}`).toBe(
        `#${listed.number}: 1 0`,
      );
    }
  });

  test("#1124 review: a lookup GitHub does not answer stops pr open, so no second PR is made", async () => {
    const f = fake({ pushed: ["a"], subjects: { a: ["fix(a): x (#1)"] }, fail: /pulls\?head=/ });
    expect(await prFlow(["open", "a"], f.deps)).toBe(1);
    expect(f.writes).toEqual([]);
    expect(f.out()).toContain("open PRs of a cannot be read");
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
