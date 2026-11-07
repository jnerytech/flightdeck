import { describe, expect, test } from "bun:test";
import {
  guardAllowLogs,
  type PrRun,
  prRunFrom,
  prRunVia,
  pushWaitViolation,
  withBudget,
} from "../lib/claude-hooks.ts";

const CWD = "/repos/flightdeck-fix";

/** A checkout on `fix-x` whose PR run is `run`; records which branches were asked about. */
function deps(run: PrRun | null, env: Record<string, string | undefined> = {}) {
  const asked: string[] = [];
  return {
    asked,
    env,
    git: (args: string[], cwd: string) =>
      cwd === CWD && args.join(" ") === "symbolic-ref --short HEAD" ? "fix-x\n" : null,
    prRun: (branch: string, dir: string) => {
      asked.push(`${branch} in ${dir}`);
      return run;
    },
  };
}
const URL = "https://github.com/jnerytech/flightdeck/actions/runs/42";
const green: PrRun = {
  id: 42,
  url: URL,
  inProgress: true,
  failed: false,
  conflicting: false,
  minutes: 6,
};

describe("push-wait: a push does not cancel a PR run that is still green (#741)", () => {
  test("a push while the branch's PR run is in progress, green and younger than 20 min is refused, naming the run", () => {
    const d = deps(green);
    const why = pushWaitViolation("git push origin fix-x", CWD, d) ?? "";
    expect(why).toContain("run 42");
    expect(why).toContain("6 min");
    // The run's age and address, and the exact line that overrides (#756 review by the coordinator).
    expect(why).toContain(URL);
    expect(why).toContain('FLIGHTDECK_PUSH_NOW="<reason>" git push origin fix-x');
    expect(d.asked).toEqual([`fix-x in ${CWD}`]);
    expect(pushWaitViolation("git push", CWD, deps(green)) ?? "").toContain("run 42");
    // The run is read in the push's own checkout (security review: `cd` or `-C` elsewhere).
    const elsewhere = deps(green);
    expect(
      pushWaitViolation("cd /repos/flightdeck-fix && git push -q", "/repos", elsewhere),
    ).not.toBeNull();
    expect(elsewhere.asked).toEqual([`fix-x in ${CWD}`]);
  });

  test("the run checked is the one of the branch the push updates, not HEAD's (#756 review)", () => {
    const other = deps(green);
    const why = pushWaitViolation("git push origin other:fix-y", CWD, other) ?? "";
    expect(other.asked).toEqual([`fix-y in ${CWD}`]);
    expect(why).toContain("on the PR of fix-y");
    const full = deps(green);
    pushWaitViolation("git push origin HEAD:refs/heads/fix-z", CWD, full);
    expect(full.asked).toEqual([`fix-z in ${CWD}`]);
    const both = deps(null);
    expect(pushWaitViolation("git push -o ci.skip origin fix-a fix-b", CWD, both)).toBeNull();
    expect(both.asked).toEqual([`fix-a in ${CWD}`, `fix-b in ${CWD}`]);
    // A delete starts no run, and a release-v* target never waits.
    const gone = deps(green);
    expect(pushWaitViolation("git push origin --delete fix-x", CWD, gone)).toBeNull();
    expect(pushWaitViolation("git push origin HEAD:release-v1.2.3", CWD, gone)).toBeNull();
    expect(gone.asked).toEqual([]);
  });

  test("a red run (the push is a fix), an ended or old run, or no run at all lets the push through", () => {
    for (const run of [
      { ...green, failed: true },
      // A PR that conflicts with main: the merge of main must go out (#756 review).
      { ...green, conflicting: true },
      { ...green, inProgress: false },
      { ...green, minutes: 20 },
      null,
    ]) {
      expect(pushWaitViolation("git push origin fix-x", CWD, deps(run))).toBeNull();
    }
  });

  test("the override line hides a token in the remote URL or a secret variable, and a run URL that is not https is left out (security review)", () => {
    const why =
      pushWaitViolation(
        "GH_TOKEN=abc123 git push https://jn:ghp_secret@github.com/jnerytech/flightdeck.git fix-x",
        CWD,
        deps(green),
      ) ?? "";
    expect(why).not.toContain("ghp_secret");
    expect(why).not.toContain("abc123");
    expect(why).toContain("https://***@github.com/jnerytech/flightdeck.git fix-x");
    expect(why).toContain("GH_TOKEN=***");
    const quoted =
      pushWaitViolation(
        'API_KEY="a b c" git -c http.extraHeader=Authorization:Bearer_xyz push',
        CWD,
        deps(green),
      ) ?? "";
    expect(quoted).toContain("run 42");
    expect(quoted).not.toContain("b c");
    expect(quoted).not.toContain("xyz");
    const odd = pushWaitViolation("git push", CWD, deps({ ...green, url: "\u001b]8;;x" })) ?? "";
    expect(odd).toContain("run 42");
    expect(odd).not.toContain("\u001b");
  });

  test("a release-v* branch never waits, and GitHub is not asked (#756 review)", () => {
    const release = {
      ...deps(green),
      git: (args: string[], cwd: string) =>
        cwd === CWD && args.join(" ") === "symbolic-ref --short HEAD" ? "release-v0.40.0\n" : null,
    };
    expect(pushWaitViolation("git push", CWD, release)).toBeNull();
    expect(release.asked).toEqual([]);
  });

  test("an override with a reason in front of the push, or the coordinator, passes without asking GitHub", () => {
    const waived = deps(green);
    expect(
      pushWaitViolation('FLIGHTDECK_PUSH_NOW="the reviewer waits on it" git push', CWD, waived),
    ).toBeNull();
    expect(waived.asked).toEqual([]);
    const coordinator = deps(green, { FLIGHTDECK_COORDINATOR: "1" });
    expect(pushWaitViolation("git push", CWD, coordinator)).toBeNull();
    expect(coordinator.asked).toEqual([]);
    // A bare switch is no reason, and an override elsewhere in the command does not count.
    for (const command of [
      "FLIGHTDECK_PUSH_NOW=1 git push",
      'echo FLIGHTDECK_PUSH_NOW="a long enough reason"; git push',
    ]) {
      expect(pushWaitViolation(command, CWD, deps(green)) ?? "allowed").toContain("run 42");
    }
  });

  test("commands that push nothing, or a checkout outside the project, never ask GitHub", () => {
    const d = deps(green);
    for (const command of ["git status", "git commit -m 'git push later'", "bun run typecheck"]) {
      expect(pushWaitViolation(command, CWD, d)).toBeNull();
    }
    const outside = { ...deps(green), inProject: () => false };
    expect(pushWaitViolation("git push", CWD, outside)).toBeNull();
    expect(d.asked).toEqual([]);
    expect(outside.asked).toEqual([]);
  });

  test("an override with a reason logs a push-wait waiver, not an allow", () => {
    expect(guardAllowLogs('FLIGHTDECK_PUSH_NOW="the reviewer waits on it" git push', {})).toEqual([
      { rule: "push-wait", decision: "waived", detail: "the reviewer waits on it" },
    ]);
    expect(guardAllowLogs("git push", {})).toEqual([{ rule: null, decision: "allow" }]);
  });
});

describe("push-wait: what an override logs (#741, #821 review)", () => {
  /** The same checkout, with a run per branch and, if given, which folders are the project's. */
  function runsBy(runs: Record<string, PrRun | null>, inProject?: (dir: string) => boolean) {
    const base = deps(null);
    return {
      ...base,
      inProject,
      prRun: (branch: string, dir: string) => {
        base.asked.push(`${branch} in ${dir}`);
        return runs[branch] ?? null;
      },
    };
  }
  const log = (command: string, d: ReturnType<typeof runsBy>, cwd = CWD) =>
    guardAllowLogs(command, {}, { cwd, deps: d });
  const waiver = (detail: string, minutes?: number): ReturnType<typeof guardAllowLogs> => [
    {
      rule: "push-wait",
      decision: "waived",
      detail,
      ...(minutes === undefined ? {} : { minutes }),
    },
  ];

  test("the reason and the age of the run the push cancels, asked in the push's own checkout", () => {
    const d = runsBy({ "fix-x": green });
    expect(log('FLIGHTDECK_PUSH_NOW="a fix after review" git push origin fix-x', d)).toEqual(
      waiver("a fix after review", 6),
    );
    expect(d.asked).toEqual([`fix-x in ${CWD}`]);
  });

  test("with two pushed branches, the youngest run in progress", () => {
    const d = runsBy({ a: { ...green, minutes: 12 }, b: { ...green, minutes: 4 } });
    expect(log('FLIGHTDECK_PUSH_NOW="both need the fix" git push origin a b', d)).toEqual(
      waiver("both need the fix", 4),
    );
    expect(d.asked).toEqual([`a in ${CWD}`, `b in ${CWD}`]);
  });

  test("a run that ended, no run, a delete or an unknown folder: the reason alone", () => {
    expect(
      log(
        'FLIGHTDECK_PUSH_NOW="a fix after review" git push',
        runsBy({ "fix-x": { ...green, inProgress: false } }),
      ),
    ).toEqual(waiver("a fix after review"));
    expect(log('FLIGHTDECK_PUSH_NOW="a fix after review" git push', runsBy({}))).toEqual(
      waiver("a fix after review"),
    );
    const gone = runsBy({ "fix-x": green });
    expect(
      log('FLIGHTDECK_PUSH_NOW="drop the old branch" git push origin --delete fix-x', gone),
    ).toEqual(waiver("drop the old branch"));
    expect(gone.asked).toEqual([]);
    const quoted = runsBy({ "fix-x": green });
    expect(
      log('cd "/repos/flight deck" && FLIGHTDECK_PUSH_NOW="a fix after review" git push', quoted),
    ).toEqual(waiver("a fix after review"));
    expect(quoted.asked).toEqual([]);
  });

  test("a push in a checkout outside the project is not the rule's: no waiver, and GitHub is not asked", () => {
    const d = runsBy({ "fix-x": green }, (dir) => dir === CWD);
    expect(log('FLIGHTDECK_PUSH_NOW="a fix after review" git push', d, "/elsewhere")).toEqual([
      { rule: null, decision: "allow" },
    ]);
    expect(d.asked).toEqual([]);
  });

  test("the coordinator logs nothing and asks nothing, with an override or without", () => {
    for (const command of ['FLIGHTDECK_PUSH_NOW="a fix after review" git push', "git push"]) {
      const d = runsBy({ "fix-x": green });
      expect(
        guardAllowLogs(command, { FLIGHTDECK_COORDINATOR: "1" }, { cwd: CWD, deps: d }),
      ).toEqual([{ rule: null, decision: "allow" }]);
      expect(d.asked).toEqual([]);
    }
  });

  test("a long reason is cut at 200 characters after its secrets are hidden", () => {
    expect(
      log(`FLIGHTDECK_PUSH_NOW="GH_TOKEN=abc123 ${"x".repeat(300)}" git push`, runsBy({})),
    ).toEqual(waiver(`GH_TOKEN=*** ${"x".repeat(187)}`));
  });

  test("control, C1, bidi and line-separator characters go first, so a secret split by one is still hidden", () => {
    expect(
      log(
        'FLIGHTDECK_PUSH_NOW="a\u001b[2Jb\u0007c\u0085d\u202ee\u2028f\u2066g\u200bh\ue000i" git push',
        runsBy({}),
      ),
    ).toEqual(waiver("a[2Jbcdefghi"));
    expect(
      log('FLIGHTDECK_PUSH_NOW="see ghp_ab\u0000cdefghijklmnop now" git push', runsBy({})),
    ).toEqual(waiver("see *** now"));
  });

  test.each([
    ["x_ghp_abc123def456", "x_***"],
    ["glpat-abcdefghij1234567890", "***"],
    ["npm_abcdefghijklmnopqrstuvwxyz0123456789", "***"],
    ["xoxb-123-456-abc", "***"],
    ["sk-abcdefghijklmnopqrstuv", "***"],
    ["AKIAABCDEFGHIJKLMNOP", "***"],
    ["eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl", "***"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: ***"],
    ["--token abc123", "--token ***"],
    ["--password=hunter2", "--password=***"],
    ["--secret 'two words'", "--secret ***"],
    ["--api-key abc123", "--api-key ***"],
    ["--github-token=abc123", "--github-token=***"],
    ["Bearer xyz", "Bearer ***"],
    // Ordinary words stay readable (#826 review).
    ["--token-count 5", "--token-count 5"],
    ["desk-abcdefghijklmnopqrstuv", "desk-abcdefghijklmnopqrstuv"],
  ])("a reason with %p logs %p", (secret, shown) => {
    expect(log(`FLIGHTDECK_PUSH_NOW="see ${secret} now" git push`, runsBy({}))).toEqual(
      waiver(`see ${shown} now`),
    );
  });

  test("the 200-character cut never splits a character in two", () => {
    expect(log(`FLIGHTDECK_PUSH_NOW="${"x".repeat(199)}\u{1F600}y" git push`, runsBy({}))).toEqual(
      waiver(`${"x".repeat(199)}\u{1F600}`),
    );
  });
});

describe("push-wait: withBudget, the guard's time limit for its gh and git calls (#826 review)", () => {
  test("a call starts only before the limit; past it, the answer is null and the call is not made", () => {
    let clock = 0;
    const calls: string[] = [];
    const budgeted = withBudget(
      (what: string) => {
        calls.push(what);
        return `done ${what}`;
      },
      () => clock,
      6000,
    );
    expect(budgeted("first")).toBe("done first");
    clock = 6000;
    expect(budgeted("at the limit")).toBe("done at the limit");
    clock = 6001;
    expect(budgeted("late")).toBeNull();
    expect(calls).toEqual(["first", "at the limit"]);
  });
});

describe("push-wait: the run and the PR as gh prints them (#741)", () => {
  const now = Date.parse("2026-11-07T01:10:00Z");
  const list = (status: string, startedAt = "2026-11-07T01:04:00Z") =>
    JSON.stringify([{ databaseId: 42, status, startedAt, url: URL }]);
  const pr = (mergeable: string, ...checks: Array<Record<string, string>>) =>
    JSON.stringify({ mergeable, statusCheckRollup: checks });
  const check = (conclusion: string) => ({
    __typename: "CheckRun",
    status: "COMPLETED",
    conclusion,
  });

  test("an in-progress run with its age and address, whether a PR check failed, and whether the PR conflicts", () => {
    expect(prRunFrom(list("in_progress"), pr("MERGEABLE", check("SUCCESS")), now)).toEqual({
      id: 42,
      url: URL,
      inProgress: true,
      failed: false,
      conflicting: false,
      minutes: 6,
    });
    expect(prRunFrom(list("queued"), pr("UNKNOWN"), now)?.inProgress).toBe(true);
    expect(prRunFrom(list("completed"), pr("MERGEABLE"), now)?.inProgress).toBe(false);
    expect(prRunFrom(list("in_progress"), pr("CONFLICTING"), now)?.conflicting).toBe(true);
    // Any failed check counts, a check run's or a commit status's, SonarCloud's included.
    for (const failed of [
      check("FAILURE"),
      check("TIMED_OUT"),
      check("STARTUP_FAILURE"),
      { __typename: "StatusContext", state: "FAILURE" },
      { __typename: "StatusContext", state: "ERROR" },
    ]) {
      expect(
        prRunFrom(list("in_progress"), pr("MERGEABLE", check("SUCCESS"), failed), now)?.failed,
      ).toBe(true);
    }
    expect(
      prRunFrom(
        list("in_progress"),
        pr("MERGEABLE", { __typename: "CheckRun", status: "IN_PROGRESS" }),
        now,
      )?.failed,
    ).toBe(false);
  });

  test("no run, output gh could not give, or output that does not parse is no run (the hook fails open)", () => {
    for (const [runs, detail] of [
      ["[]", pr("MERGEABLE")],
      [null, pr("MERGEABLE")],
      ["{ nope", pr("MERGEABLE")],
      [list("in_progress"), null],
      [list("in_progress"), "{ nope"],
      [JSON.stringify([{ databaseId: 42, status: "in_progress", url: URL }]), pr("MERGEABLE")],
    ] as const) {
      expect(prRunFrom(runs, detail, now)).toBeNull();
    }
  });
});

describe("push-wait: the gh calls the guard makes (#756 review)", () => {
  const now = Date.parse("2026-11-07T01:10:00Z");
  const runs = JSON.stringify([
    { databaseId: 42, status: "in_progress", startedAt: "2026-11-07T01:04:00Z", url: URL },
  ]);
  const view = JSON.stringify({ mergeable: "MERGEABLE", statusCheckRollup: [] });

  test("lists the branch's latest PR run, then reads its PR, both in the push's folder", () => {
    const calls: string[] = [];
    const gh = (args: string[], dir: string) => {
      calls.push(`${dir}: ${args.join(" ")}`);
      return args[0] === "run" ? runs : view;
    };
    expect(prRunVia(gh, () => now)("fix-x", CWD)).toEqual(green);
    expect(calls).toEqual([
      `${CWD}: run list --branch=fix-x --event=pull_request --limit=1 --json=databaseId,status,startedAt,url`,
      `${CWD}: pr view --json=mergeable,statusCheckRollup -- fix-x`,
    ]);
  });

  test("no run, or gh failing, is no run, and the PR is not read then", () => {
    for (const listed of ["[]\n", null]) {
      const calls: string[][] = [];
      const gh = (args: string[]) => {
        calls.push(args);
        return args[0] === "run" ? listed : view;
      };
      expect(prRunVia(gh, () => now)("fix-x", CWD)).toBeNull();
      expect(calls.length).toBe(1);
    }
    expect(
      prRunVia(
        (args) => (args[0] === "run" ? runs : null),
        () => now,
      )("fix-x", CWD),
    ).toBeNull();
  });
});
