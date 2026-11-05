import { describe, expect, test } from "bun:test";
import { runHandoff, STEPS, stampProblem } from "../lib/handoff.ts";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

describe("handoff-check", () => {
  test("every step runs in order, and the stamp names the branch, the HEAD and each exit code", async () => {
    const ran: string[] = [];
    const result = await runHandoff({
      run: async (command) => {
        ran.push(command.join(" "));
        return 0;
      },
      branch: "fix-x",
      head: HEAD,
      now: "2026-11-05T12:00:00Z",
    });
    expect(ran).toEqual(STEPS.map(([, command]) => command.join(" ")));
    expect(result).toEqual({
      code: 0,
      stamp: `HANDOFF fix-x ${HEAD} typecheck=0 lint=0 audit=0 related=0 2026-11-05T12:00:00Z`,
    });
  });

  test("a failing step does not stop the others, and the run fails", async () => {
    const ran: string[] = [];
    const result = await runHandoff({
      run: async (command) => {
        ran.push(command[2] ?? "");
        return command[2] === "lint" ? 1 : 0;
      },
      branch: "fix-x",
      head: HEAD,
      now: "t",
    });
    expect(ran).toEqual(["typecheck", "lint", "tdd:audit", "test:related"]);
    expect(result.code).toBe(1);
    expect(result.stamp).toContain("lint=1");
  });

  test("a stamp vouches only for the HEAD it names, with every check at 0", () => {
    const good = `HANDOFF fix-x ${HEAD} typecheck=0 lint=0 audit=0 related=0 t`;
    expect(stampProblem(good, HEAD)).toBeNull();
    expect(stampProblem(good, "f".repeat(40)) ?? "").toContain("stale");
    expect(stampProblem(good.replace("audit=0", "audit=1"), HEAD) ?? "").toContain("audit=1");
    expect(stampProblem(null, HEAD) ?? "").toContain("no stamp");
    expect(stampProblem("garbage", HEAD) ?? "").toContain("not a stamp");
  });

  test("--base reaches test:related, for a branch stacked on another (#266)", async () => {
    const ran: string[] = [];
    await runHandoff({
      run: async (command) => {
        ran.push(command.join(" "));
        return 0;
      },
      branch: "ci-paths",
      head: HEAD,
      now: "t",
      base: "ci-shards",
    });
    expect(ran.at(-1)).toBe("bun run test:related -- --fast --base ci-shards");
  });

  test("the stamp carries the CI of HEAD, and vouches only when it is green too (#266)", async () => {
    const stamp = async (ci: string) =>
      runHandoff({ run: async () => 0, branch: "b", head: HEAD, now: "t", ci: async () => ci });
    const pending = await stamp("pending");
    expect(pending.stamp).toBe(
      `HANDOFF b ${HEAD} typecheck=0 lint=0 audit=0 related=0 ci=pending t`,
    );
    expect(pending.code).toBe(1);
    expect(stampProblem(pending.stamp, HEAD)).toBe("failed: ci=pending");
    const green = await stamp("0");
    expect(green.code).toBe(0);
    expect(stampProblem(green.stamp, HEAD)).toBeNull();
    expect(stampProblem((await stamp("skip")).stamp, HEAD)).toBe("failed: ci=skip");
  });

  test("a hostile stamp is refused in linear time (Sonar S5852) (#232)", () => {
    // A digit can end one pair or start the next: the old pattern backtracked 2^n times on a miss.
    const hostile = `HANDOFF b ${HEAD} ${"x=11".repeat(24)} a b`;
    const started = performance.now();
    expect(stampProblem(hostile, HEAD) ?? "").toContain("not a stamp");
    expect(performance.now() - started).toBeLessThan(200);
  });
});
