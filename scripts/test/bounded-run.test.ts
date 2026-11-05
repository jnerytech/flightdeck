import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { killTree, type RunDeps, runBounded, SYSTEM_KILL } from "../lib/bounded-run.ts";
import { realTempDir } from "./temp-dir.ts";

const BUN = process.execPath;

/** A fake process, timer and tree kill for runBounded: nothing real starts or waits. */
function fakeRun(platform: NodeJS.Platform, pid: number | null = 4242) {
  const child = Object.assign(new EventEmitter(), { pid: pid ?? undefined });
  const spawned: [string, string[], { detached: boolean }][] = [];
  const timers: number[] = [];
  const cleared: unknown[] = [];
  const killed: number[] = [];
  let fire: () => void = () => {};
  const deps: RunDeps = {
    platform,
    spawn: (program, args, options) => {
      spawned.push([program, args, options]);
      return child;
    },
    setTimer: (callback, ms) => {
      timers.push(ms);
      fire = callback;
      return "timer";
    },
    clearTimer: (timer) => {
      cleared.push(timer);
    },
    killTree: (target) => {
      killed.push(target);
    },
  };
  return { deps, child, spawned, timers, cleared, killed, fire: () => fire() };
}
describe("bounded-run", () => {
  test("a command that ends gives its exit code and nothing of what it printed: a hook that inherits the environment may print a token (#273)", async () => {
    const result = await runBounded(
      [BUN, "-e", 'console.error("Authorization: Bearer ghp_secret"); process.exit(3)'],
      10_000,
    );
    expect(result.code).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
  });

  test("a program that does not exist is a failure with the reason, never a throw (#273)", async () => {
    const result = await runBounded(["flightdeck-no-such-program-273"], 10_000);
    expect(result.code).toBeNull();
    expect(result.stderr).toContain("flightdeck-no-such-program-273");
  });

  test("past the deadline the child's tree is killed and the call returns at once; a later exit changes nothing (#284)", async () => {
    const run = fakeRun("linux");
    const pending = runBounded(["hook", "--x"], 1_500, run.deps);
    expect(run.spawned).toEqual([["hook", ["--x"], { detached: true }]]);
    expect(run.timers).toEqual([1_500]);
    run.fire();
    run.child.emit("exit", 0);
    expect(await pending).toEqual({ code: null, stderr: "", timedOut: true });
    expect(run.killed).toEqual([4242]);
  });

  test("an exit before the deadline clears the timer and kills nothing; Windows starts no group (#284)", async () => {
    const run = fakeRun("win32");
    const pending = runBounded(["hook"], 1_500, run.deps);
    expect(run.spawned[0]?.[2]).toEqual({ detached: false });
    run.child.emit("exit", 3);
    expect(await pending).toEqual({ code: 3, stderr: "", timedOut: false });
    expect(run.cleared).toEqual(["timer"]);
    run.fire();
    expect(run.killed).toEqual([]);
  });

  test("a child that never got a pid is not killed at the deadline (#284)", async () => {
    const run = fakeRun("linux", null);
    const pending = runBounded(["hook"], 1_500, run.deps);
    run.fire();
    expect((await pending).timedOut).toBe(true);
    expect(run.killed).toEqual([]);
  });

  test("the tree kill is taskkill /T on Windows and a group SIGKILL elsewhere; a process already gone is no error (#273)", () => {
    const calls: string[] = [];
    const deps = {
      runSync: (program: string, args: string[]) => {
        calls.push([program.replaceAll("\\", "/"), ...args].join(" "));
      },
      kill: (pid: number, signal: string) => {
        calls.push(`kill ${pid} ${signal}`);
      },
    };
    killTree(42, { ...deps, platform: "win32", systemRoot: "D:/Win" });
    killTree(42, { ...deps, platform: "linux" });
    expect(calls).toEqual(["D:/Win/System32/taskkill.exe /T /F /PID 42", "kill -42 SIGKILL"]);
    const gone = {
      ...deps,
      platform: "linux" as const,
      kill: () => {
        throw new Error("ESRCH");
      },
    };
    expect(() => killTree(42, gone)).not.toThrow();
  });

  test("the system's runSync runs a program to its end (#273)", () => {
    const dir = realTempDir("bounded-run-sync-");
    const mark = join(dir, "ran");
    SYSTEM_KILL.runSync(BUN, [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "1")`,
    ]);
    expect(existsSync(mark)).toBe(true);
  });

  test("the system's kill ends a process, on any system (#273)", async () => {
    const child = Bun.spawn([BUN, "-e", "setInterval(() => {}, 1000)"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    SYSTEM_KILL.kill(child.pid, "SIGKILL");
    expect(await child.exited).not.toBe(0);
  });
});
