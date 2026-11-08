import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  budgetedGh,
  guardAllowLogs,
  type PrRun,
  prRunFrom,
  prRunVia,
  pushWaitCheck,
  pushWaitViolation,
  withBudget,
} from "../lib/claude-hooks.ts";

// resolve: on Windows a `cd /repos/...` lands in D:\repos\..., and so must the expected folder (#534).
const CWD = resolve("/repos/flightdeck-fix");

/** A checkout on `fix-x` whose PR run is `run`; records which branches were asked about. */
function deps(run: PrRun | "none" | null, env: Record<string, string | undefined> = {}) {
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
      pushWaitViolation("cd /repos/flightdeck-fix && git push -q", resolve("/repos"), elsewhere),
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
    const both = deps("none");
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
      "none" as const,
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

  test("GitHub that cannot be read is asked once more, then the push holds, naming the override (#741)", () => {
    const down = deps(null);
    const why = pushWaitViolation("git push origin fix-x", CWD, down) ?? "";
    expect(why).toContain("GitHub could not be read");
    expect(why).toContain('FLIGHTDECK_PUSH_NOW="<reason>" git push origin fix-x');
    expect(down.asked).toEqual([`fix-x in ${CWD}`, `fix-x in ${CWD}`]);
    // The second answer decides: a green run still holds, no run lets the push through.
    const answers = (...runs: Array<PrRun | "none" | null>) => ({
      ...deps(null),
      prRun: () => runs.shift() ?? null,
    });
    expect(pushWaitViolation("git push origin fix-x", CWD, answers(null, green)) ?? "").toContain(
      "run 42",
    );
    expect(pushWaitViolation("git push origin fix-x", CWD, answers(null, "none"))).toBeNull();
  });

  test("when no lookup could say anything (gh missing, no time left), the push goes and logs why (#945 review)", () => {
    for (const why of ["gh missing", "no time"]) {
      const d = { ...deps(null), whyUnread: () => why };
      expect(pushWaitCheck("git push origin fix-x", CWD, d)).toEqual({
        violation: null,
        passes: [{ reason: why }],
      });
    }
    // A reason left by an earlier branch's lookups is cleared first, so it never passes this one.
    const stale = ["no time", null];
    const left = { ...deps(null), whyUnread: () => stale.shift() ?? null };
    expect(pushWaitViolation("git push origin fix-x", CWD, left) ?? "").toContain(
      "GitHub could not be read",
    );
    // GitHub that answered with a failure still holds.
    const failed = { ...deps(null), whyUnread: () => null };
    expect(pushWaitViolation("git push origin fix-x", CWD, failed) ?? "").toContain(
      "GitHub could not be read",
    );
  });

  test("the override line in a refusal is printable too (#945 review)", () => {
    const why = pushWaitViolation("git push origin fix-\u001b[2Jx", CWD, deps(green)) ?? "";
    expect(why).toContain("FLIGHTDECK_PUSH_NOW");
    expect(why).not.toContain("\u001b");
  });

  test("a branch name with control characters reaches neither refusal raw (#945 security review)", () => {
    for (const run of [green, null]) {
      const d = {
        ...deps(run),
        git: (args: string[]) =>
          args.join(" ") === "symbolic-ref --short HEAD" ? "fix-\u001b[2Jx\n" : null,
      };
      const why = pushWaitViolation("git push", CWD, d) ?? "";
      expect(why).toContain("fix-[2Jx");
      expect(why).not.toContain("\u001b");
    }
  });

  test("each push the rule lets through says why: a failed check, a conflict, a run that ended or is old, no run (#741)", () => {
    const passes = (run: PrRun | "none") => pushWaitCheck("git push origin fix-x", CWD, deps(run));
    expect(passes({ ...green, failed: true })).toEqual({
      violation: null,
      passes: [{ reason: "failed check" }],
    });
    expect(passes({ ...green, conflicting: true }).passes).toEqual([{ reason: "conflicts" }]);
    expect(passes({ ...green, inProgress: false }).passes).toEqual([{ reason: "run ended" }]);
    expect(passes({ ...green, minutes: 25 }).passes).toEqual([{ reason: "old run", minutes: 25 }]);
    expect(passes("none").passes).toEqual([{ reason: "no run" }]);
    expect(passes(green)).toEqual({
      violation: pushWaitViolation("git push origin fix-x", CWD, deps(green)),
      passes: [],
    });
    // A delete, a release-v* branch and an override are no pass of the rule: nothing is asked.
    for (const command of [
      "git push origin --delete fix-x",
      "git push origin HEAD:release-v1.2.3",
      'FLIGHTDECK_PUSH_NOW="a fix after review" git push',
    ]) {
      expect(pushWaitCheck(command, CWD, deps(green)).passes).toEqual([]);
    }
  });

  test("the guard logs a pass as a push-wait allow with its reason, in place of the plain allow (#741)", () => {
    expect(
      guardAllowLogs("git push", {}, undefined, [
        { reason: "old run", minutes: 25 },
        { reason: "no run" },
      ]),
    ).toEqual([
      { rule: "push-wait", decision: "allow", detail: "old run", minutes: 25 },
      { rule: "push-wait", decision: "allow", detail: "no run" },
    ]);
    expect(guardAllowLogs("git push", {}, undefined, [])).toEqual([
      { rule: null, decision: "allow" },
    ]);
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
  function runsBy(
    runs: Record<string, PrRun | "none" | null>,
    inProject?: (dir: string) => boolean,
  ) {
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

describe("push-wait: budgetedGh, the guard's gh with its time limit (#945 review)", () => {
  test("a call starts only before the limit, and says why GitHub went unread when nothing could answer", () => {
    let t = 0;
    const ran: string[] = [];
    const spawn = (args: string[]) => {
      ran.push(args[0] ?? "");
      return args[0] === "missing"
        ? { stdout: null, missing: true }
        : { stdout: args[0] === "fail" ? null : "ok", missing: false };
    };
    const ok = budgetedGh(
      spawn,
      () => true,
      () => t,
      6000,
    );
    expect(ok.gh(["run"], CWD)).toBe("ok");
    expect(ok.gh(["fail"], CWD)).toBeNull();
    // A call that ran and failed is GitHub's answer: no reason to pass.
    expect(ok.whyUnread()).toBeNull();
    const missing = budgetedGh(
      spawn,
      () => true,
      () => t,
      6000,
    );
    expect(missing.gh(["missing"], CWD)).toBeNull();
    expect(missing.whyUnread()).toBe("gh missing");
    const late = budgetedGh(
      spawn,
      () => true,
      () => t,
      6000,
    );
    t = 6001;
    expect(late.gh(["run"], CWD)).toBeNull();
    expect(late.whyUnread()).toBe("no time");
    // Read once: the next branch's lookups start with no reason left over (#945 security review).
    expect(late.whyUnread()).toBeNull();
    expect(ran).toEqual(["run", "fail", "missing"]);
    // ENOENT in a folder that does not exist is that folder, not gh: no reason to pass (high).
    const gone = budgetedGh(
      spawn,
      (dir) => dir !== "/nowhere",
      () => 0,
      6000,
    );
    expect(gone.gh(["missing"], "/nowhere")).toBeNull();
    expect(gone.whyUnread()).toBeNull();
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
  /** The run read, or null when there is none (the field checks below read a run). */
  const read = (runs: string, view: string) => {
    const run = prRunFrom(runs, view, now);
    return run === "none" ? null : run;
  };
  const check = (conclusion: string) => ({
    __typename: "CheckRun",
    status: "COMPLETED",
    conclusion,
  });

  test("a run address that is not text is empty, never [object Object] (S6551)", () => {
    const runs = JSON.stringify([
      {
        databaseId: 42,
        status: "in_progress",
        startedAt: "2026-11-07T01:04:00Z",
        url: { href: URL },
      },
    ]);
    expect(read(runs, pr("MERGEABLE"))?.url).toBe("");
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
    expect(read(list("queued"), pr("UNKNOWN"))?.inProgress).toBe(true);
    expect(read(list("completed"), pr("MERGEABLE"))?.inProgress).toBe(false);
    expect(read(list("in_progress"), pr("CONFLICTING"))?.conflicting).toBe(true);
    // Any failed check counts, a check run's or a commit status's, SonarCloud's included.
    for (const failed of [
      check("FAILURE"),
      check("TIMED_OUT"),
      check("STARTUP_FAILURE"),
      { __typename: "StatusContext", state: "FAILURE" },
      { __typename: "StatusContext", state: "ERROR" },
    ]) {
      expect(read(list("in_progress"), pr("MERGEABLE", check("SUCCESS"), failed))?.failed).toBe(
        true,
      );
    }
    expect(
      read(list("in_progress"), pr("MERGEABLE", { __typename: "CheckRun", status: "IN_PROGRESS" }))
        ?.failed,
    ).toBe(false);
  });

  test("an empty list is no run; output gh could not give, or that does not parse, is GitHub unread (null, #741)", () => {
    expect(prRunFrom("[]", pr("MERGEABLE"), now)).toBe("none");
    expect(prRunFrom("[]\n", null, now)).toBe("none");
    // A PR that cannot be read leaves the run's age to decide: no failed check, no conflict known (#945 review).
    for (const view of [null, "{ nope"]) {
      expect(prRunFrom(list("in_progress"), view, now)).toEqual({
        id: 42,
        url: URL,
        inProgress: true,
        failed: false,
        conflicting: false,
        minutes: 6,
      });
    }
    for (const [runs, detail] of [
      [null, pr("MERGEABLE")],
      ["{ nope", pr("MERGEABLE")],
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

  test("no run is none and gh failing is null (#741), and the PR is not read then", () => {
    for (const [listed, read] of [
      ["[]\n", "none"],
      [null, null],
    ] as const) {
      const calls: string[][] = [];
      const gh = (args: string[]) => {
        calls.push(args);
        return args[0] === "run" ? listed : view;
      };
      expect(prRunVia(gh, () => now)("fix-x", CWD)).toBe(read);
      expect(calls).toHaveLength(1);
    }
    // The run listed but its PR unread: the run's age decides (#945 review).
    expect(
      prRunVia(
        (args) => (args[0] === "run" ? runs : null),
        () => now,
      )("fix-x", CWD),
    ).toEqual(green);
  });
});
