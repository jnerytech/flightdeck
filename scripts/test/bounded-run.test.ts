import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree, runBounded, SYSTEM_KILL } from "../lib/bounded-run.ts";

const BUN = process.execPath;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("bounded-run", () => {
  test("a command that ends gives its exit code and the tail of its stderr (#273)", async () => {
    const result = await runBounded(
      [BUN, "-e", 'console.error("x".repeat(900) + "the end"); process.exit(3)'],
      10_000,
    );
    expect(result.code).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.stderr.endsWith("the end")).toBe(true);
    expect(result.stderr.length).toBeLessThanOrEqual(500);
  });

  test("a program that does not exist is a failure with the reason, never a throw (#273)", async () => {
    const result = await runBounded(["flightdeck-no-such-program-273"], 10_000);
    expect(result.code).toBeNull();
    expect(result.stderr).toContain("flightdeck-no-such-program-273");
  });

  test("past the deadline the whole group dies, a grandchild that holds stderr too, and the call returns (#273)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bounded-run-"));
    const pidFile = join(dir, "grandchild.pid");
    // The child starts a grandchild that shares its stderr, writes its pid, then both hang.
    const child = [
      'const { spawn } = require("node:child_process");',
      `const g = spawn(${JSON.stringify(BUN)}, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "inherit"] });`,
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
      "process.on('SIGTERM', () => {});",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const started = performance.now();
    const result = await runBounded([BUN, "-e", child], 1_500);
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(performance.now() - started).toBeLessThan(8_000);
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    let dead = false;
    for (let i = 0; i < 50 && !dead; i++) {
      dead = !alive(grandchild);
      if (!dead) await Bun.sleep(100);
    }
    expect(dead).toBe(true);
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
    const dir = mkdtempSync(join(tmpdir(), "bounded-run-sync-"));
    const mark = join(dir, "ran");
    SYSTEM_KILL.runSync(BUN, [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "1")`,
    ]);
    expect(existsSync(mark)).toBe(true);
  });
});
