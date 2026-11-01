import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WatchSettings } from "@flightdeck/protocol";
import { killTree, runCommand } from "../src/board/command.ts";
import { shellCheckRunner } from "../src/workflows/check-runner.ts";
import { tempDir } from "./helpers.ts";
import { cleanups, fixture, work } from "./watch-helpers.ts";

setDefaultTimeout(30_000);

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A script that starts a child that never ends, says its pid, and never ends itself. */
function hangingScript(): string {
  const file = join(tempDir("fd-hang-"), "hang.js");
  writeFileSync(
    file,
    `const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
console.log(child.pid);
setInterval(() => {}, 1000);
`,
  );
  return file;
}

describe("check-timeout: a command that runs out of time is killed with everything it started", () => {
  test("a hung command and its child are killed at the limit, and the result says it timed out", async () => {
    const file = hangingScript();
    const started = Date.now();
    // The limit has to outlast a slow start of the script on a loaded machine: it can only
    // name its child once it runs, and a kill before that leaves nothing to look for.
    const result = await runCommand([process.execPath, file], tempDir("fd-cwd-"), undefined, 3000);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
    const child = Number(result.stdout.trim());
    expect(child).toBeGreaterThan(0);
    for (let i = 0; i < 100 && alive(child); i++) await Bun.sleep(20);
    expect(alive(child)).toBe(false);
  });

  test("a command that ends in time is not touched by the limit", async () => {
    const result = await runCommand(
      [process.execPath, "-e", "console.log('oi')"],
      tempDir("fd-cwd-"),
      undefined,
      20_000,
    );
    expect(result).toEqual({ code: 0, stdout: "oi\n", stderr: "" });
  });

  test("on Windows the tree goes with taskkill, elsewhere the whole process group is killed", () => {
    const spawned: string[][] = [];
    killTree(
      42,
      "win32",
      () => {},
      (cmd) => spawned.push(cmd),
    );
    expect(spawned).toEqual([["taskkill", "/PID", "42", "/T", "/F"]]);
    const killed: Array<[number, string]> = [];
    killTree(
      42,
      "linux",
      (pid, signal) => killed.push([pid, signal]),
      () => {},
    );
    expect(killed).toEqual([[-42, "SIGKILL"]]);
  });

  test("a pid that is not a child's is never killed: the daemon's own, 1, 0, negative, NaN, fractions", () => {
    const killed: number[] = [];
    const spawned: string[][] = [];
    for (const pid of [
      process.pid,
      1,
      0,
      -1,
      -process.pid,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      4.5,
    ]) {
      killTree(
        pid,
        "linux",
        (target) => killed.push(target),
        () => {},
      );
      killTree(
        pid,
        "win32",
        () => {},
        (cmd) => spawned.push(cmd),
      );
    }
    expect(killed).toEqual([]);
    expect(spawned).toEqual([]);
  });

  test("the check runner gives a check 10 minutes by default and says when one timed out", async () => {
    const dir = tempDir("fd-check-");
    const file = hangingScript();
    const result = await shellCheckRunner({}).run(`bun ${file}`, dir, 600);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("timed out");
  });

  test("a project's checks get its time limit, 10 minutes unless it says otherwise", async () => {
    const f = await fixture({ settings: { checks: ["bun test"] } });
    await f.fixer.onTrigger(f.trigger({ comments: [work()] }));
    await f.fixer.idle();
    expect(f.timeouts).toEqual([10 * 60_000]);
    expect(WatchSettings.shape.checkTimeoutMin.safeParse(0).success).toBe(false);
    expect(WatchSettings.shape.checkTimeoutMin.safeParse(61).success).toBe(false);
    const custom = await fixture({ settings: { checks: ["bun test"], checkTimeoutMin: 2 } });
    await custom.fixer.onTrigger(custom.trigger({ comments: [work()] }));
    await custom.fixer.idle();
    expect(custom.timeouts).toEqual([2 * 60_000]);
  });

  test("a check that timed out fails the round, says so with the command and the limit, and nothing is pushed", async () => {
    const f = await fixture({ settings: { checks: ["bun test"] }, checkTimedOut: ["bun test"] });
    await f.fixer.onTrigger(f.trigger({ comments: [work()] }));
    await f.fixer.idle();
    const [round] = f.fixer.rounds(f.card.id);
    expect(round?.status).toBe("failed");
    expect(round?.summary).toContain("local check timed out: bun test");
    expect(round?.summary).toContain("10 min");
    expect(f.gitCalls.some((args) => args[0] === "push")).toBe(false);
  });
});
