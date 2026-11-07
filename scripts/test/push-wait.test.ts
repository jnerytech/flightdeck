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
    prRun: (branch: string) => {
      asked.push(branch);
      return run;
    },
  };
}
const green: PrRun = { id: 42, inProgress: true, failed: false, minutes: 6 };

describe("push-wait: a push does not cancel a PR run that is still green (#741)", () => {
  test("a push while the branch's PR run is in progress, green and younger than 20 min is refused, naming the run", () => {
    const d = deps(green);
    const why = pushWaitViolation("git push origin fix-x", CWD, d) ?? "";
    expect(why).toContain("run 42");
    expect(why).toContain("6 min");
    expect(why).toContain('FLIGHTDECK_PUSH_NOW="<reason>"');
    expect(d.asked).toEqual(["fix-x"]);
    expect(pushWaitViolation("git push", CWD, deps(green)) ?? "").toContain("run 42");
    expect(
      pushWaitViolation("cd /repos/flightdeck-fix && git push -q", "/repos", deps(green)),
    ).not.toBeNull();
  });

  test("a red run (the push is a fix), an ended or old run, or no run at all lets the push through", () => {
    for (const run of [
      { ...green, failed: true },
      { ...green, inProgress: false },
      { ...green, minutes: 20 },
      null,
    ]) {
      expect(pushWaitViolation("git push origin fix-x", CWD, deps(run))).toBeNull();
    }
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

describe("push-wait: the run as gh prints it (#741)", () => {
  const now = Date.parse("2026-11-07T01:10:00Z");
  const list = (status: string, startedAt = "2026-11-07T01:04:00Z") =>
    JSON.stringify([{ databaseId: 42, status, startedAt }]);
  const jobs = (...conclusions: string[]) =>
    JSON.stringify({ jobs: conclusions.map((conclusion) => ({ conclusion })) });

  test("an in-progress run with its minutes, and whether a job failed already", () => {
    expect(prRunFrom(list("in_progress"), jobs("success", ""), now)).toEqual({
      id: 42,
      inProgress: true,
      failed: false,
      minutes: 6,
    });
    expect(prRunFrom(list("queued"), jobs(""), now)?.inProgress).toBe(true);
    expect(prRunFrom(list("in_progress"), jobs("success", "failure"), now)?.failed).toBe(true);
    expect(prRunFrom(list("completed"), null, now)?.inProgress).toBe(false);
  });

  test("no run, output gh could not give, or output that does not parse is no run (the hook fails open)", () => {
    for (const [runs, detail] of [
      ["[]", jobs()],
      [null, jobs()],
      ["{ nope", jobs()],
      [list("in_progress"), null],
      [list("in_progress"), "{ nope"],
      [JSON.stringify([{ databaseId: 42, status: "in_progress" }]), jobs()],
    ] as const) {
      expect(prRunFrom(runs, detail, now)).toBeNull();
    }
  });
});
