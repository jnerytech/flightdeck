import { describe, expect, test } from "bun:test";
import { guardAllowLogs, type PrRun, prRunFrom, pushWaitViolation } from "../lib/claude-hooks.ts";

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
      { rule: "push-wait", decision: "waived" },
    ]);
    expect(guardAllowLogs("git push", {})).toEqual([{ rule: null, decision: "allow" }]);
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
