import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { checkCommandRefusal } from "../src/watch/check-command.ts";
import { whichOnPath } from "../src/which.ts";
import { boundedCheckRunner, checkEnvironment } from "../src/workflows/check-runner.ts";
import { tempDir } from "./helpers.ts";

setDefaultTimeout(15_000);

/**
 * Issue #1361 (slice 1a): what a stored check command must pass before it runs unattended, the
 * environment it gets, and the runner that bounds its output and stops on a signal
 * (docs/decisions/2026-11-09-check-loop.md).
 */
describe("check-loop: the rules a stored check command passes", () => {
  const tree = "/w/tree";
  const refusal = (command: string) => checkCommandRefusal(command, tree, "linux");

  test("plain commands inside the worktree run; a shell's syntax, an environment assignment or a path outside are refused", () => {
    const allowed = [
      "bun test",
      "bun run lint",
      "bun test src/a.test.ts",
      "./node_modules/.bin/tsc -p .",
      "npm test -- --run",
      "/w/tree/bin/check",
      "bun test --reporter=junit --reporter-outfile=out/j.xml",
    ];
    const refused: Array<[string, string]> = [
      ["echo $HOME", "not_plain"],
      ["bun test | tee x", "not_plain"],
      ["FOO=1 bun test", "env_assignment"],
      ["LD_PRELOAD=x.so ls", "env_assignment"],
      ["rm -rf /", "outside_worktree"],
      ["cat /etc/passwd", "outside_worktree"],
      ["node ../x.js", "outside_worktree"],
      ["node src/../../x.js", "outside_worktree"],
      ["gcc -I/etc x.c", "outside_worktree"],
      ["tool --config=/etc/x", "outside_worktree"],
      ["tool --x:/y", "outside_worktree"],
      ["tool a,/y", "outside_worktree"],
      ["tool @/x", "outside_worktree"],
      ["curl http://x/y", "outside_worktree"],
      ["tool //server/share", "outside_worktree"],
      ["tool C:/x", "outside_worktree"],
    ];
    expect([allowed.map(refusal), refused.map(([command]) => [command, refusal(command)])]).toEqual(
      [allowed.map(() => null), refused],
    );
  });

  test("on Windows: a drive letter, a drive-relative path or another case of the worktree are read as Windows does", () => {
    const win = (command: string) => checkCommandRefusal(command, "C:\\w\\tree", "win32");
    expect([
      win("bun test C:/W/Tree/src"),
      win("bun test src"),
      win("bun test D:/x"),
      win("bun test C:x"),
      win("bun test C:/w/tree/../x"),
      win("bun test //server/share"),
      win("bun test C:/w/tree./..."),
    ]).toEqual([
      null,
      null,
      "outside_worktree",
      "outside_worktree",
      "outside_worktree",
      "outside_worktree",
      null,
    ]);
  });
});

describe("check-loop: the environment of a bounded check", () => {
  test("POSIX: only the allowlisted names of the daemon's own, and CI=1; no key or Flightdeck variable", () => {
    const source = {
      PATH: "/bin",
      HOME: "/home/p",
      LANG: "C.UTF-8",
      ANTHROPIC_API_KEY: "k-test",
      GITHUB_TOKEN: "t-test",
      FLIGHTDECK_CHECK_GUARD: "/g",
      SOMETHING_ELSE: "x",
    };
    expect(checkEnvironment(source, "linux")).toEqual({
      PATH: "/bin",
      HOME: "/home/p",
      LANG: "C.UTF-8",
      CI: "1",
    });
  });

  test("Windows: the names are matched in any case and keep their own spelling", () => {
    const source = {
      Path: "C:\\bin",
      SYSTEMROOT: "C:\\Windows",
      UserProfile: "C:\\Users\\p",
      HOME: "/home/p",
      Anthropic_Api_Key: "k-test",
    };
    expect(checkEnvironment(source, "win32")).toEqual({
      Path: "C:\\bin",
      SYSTEMROOT: "C:\\Windows",
      UserProfile: "C:\\Users\\p",
      CI: "1",
    });
  });
});

// The runner's own process: POSIX scripts, since the test guard allows only folders the test
// lists. Windows runs the same runner through cmd.exe and is checked by hand (#14).
describe.skipIf(process.platform === "win32")("check-loop: the bounded runner", () => {
  const savedPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  /** A script on PATH that the test guard lets through. */
  function script(name: string, body: string): string {
    const dir = tempDir();
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    process.env.PATH = [dir, savedPath].join(delimiter);
    const guard = process.env.FLIGHTDECK_CHECK_GUARD;
    if (guard) appendFileSync(join(guard, "allowed"), `${dir}\n`);
    return dir;
  }

  test("the check gets the allowlist, never the daemon's keys", async () => {
    const dir = script("envdump", "env");
    const env = { ...process.env, ANTHROPIC_API_KEY: "k-test", FLIGHTDECK_SECRET: "s" };
    const result = await boundedCheckRunner(env).run("envdump", dir, 5000);
    const names = result.output.split("\n").map((line) => line.split("=")[0]);
    expect([
      result.exitCode,
      names.includes("PATH"),
      names.includes("CI"),
      names.includes("ANTHROPIC_API_KEY"),
      names.includes("FLIGHTDECK_SECRET"),
      names.includes("FLIGHTDECK_CHECK_GUARD"),
    ]).toEqual([0, true, true, false, false, false]);
  });

  test("past the output bound the check and the child it left are killed, and the result says so", async () => {
    const dir = script(
      "big",
      "sleep 30 &\ni=0\nwhile [ $i -lt 400 ]; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done\nwait",
    );
    const started = Date.now();
    const result = await boundedCheckRunner(process.env, 1024).run("big", dir, 20_000);
    expect([
      result.tooLarge,
      result.output.length <= 1024 + 64 * 1024,
      Date.now() - started < 5000,
    ]).toEqual([true, true, true]);
  });

  test("the caller's signal kills the check and its tree at once", async () => {
    const dir = script("slow", "sleep 30 &\nwait");
    const stop = new AbortController();
    const started = Date.now();
    const running = boundedCheckRunner(process.env).run("slow", dir, 20_000, stop.signal);
    setTimeout(() => stop.abort(), 200);
    const result = await running;
    expect([result.aborted, Date.now() - started < 5000]).toEqual([true, true]);
  });

  // A process that left the group (setsid) keeps the pipes open after the kill: the runner gives
  // the readers a short grace, then stops reading, instead of hanging until it ends.
  test.skipIf(!whichOnPath("setsid"))(
    "after the kill, a process that left the group does not hold the runner",
    async () => {
      const dir = script("escapes", "setsid sleep 8 &\nsleep 8");
      const started = Date.now();
      const result = await boundedCheckRunner(process.env).run("escapes", dir, 300);
      expect([result.timedOut, Date.now() - started < 5000]).toEqual([true, true]);
    },
  );

  test("a check that fails gives its exit code and its whole output, stdout then stderr", async () => {
    const dir = script("fails", "echo out\necho err >&2\nexit 3");
    const result = await boundedCheckRunner(process.env).run("fails", dir, 5000);
    expect([result.exitCode, result.output]).toEqual([3, "out\nerr\n"]);
  });
});
