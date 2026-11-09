import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { runLimited } from "../src/board/command.ts";
import { checkCommandRefusal } from "../src/watch/check-command.ts";
import { whichOnPath } from "../src/which.ts";
import { boundedCheckRunner, checkEnvironment } from "../src/workflows/check-runner.ts";
import { poll, tempDir } from "./helpers.ts";

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
// lists. Windows runs the same runner through cmd.exe and is checked by hand (#14). Each script
// writes the pid of the child it leaves, so a test asserts that child is gone, not a time.
describe.skipIf(process.platform === "win32")("check-loop: the bounded runner", () => {
  const savedPath = process.env.PATH;
  const children: number[] = [];
  afterEach(() => {
    process.env.PATH = savedPath;
    // Nothing a failed assertion left behind keeps running.
    for (const pid of children.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
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

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /** The child a script left, and whether it is gone within a second of the run's end. */
  async function childGone(dir: string): Promise<boolean> {
    const pid = Number(readFileSync(join(dir, "child.pid"), "utf8").trim());
    children.push(pid);
    return (await poll(() => !alive(pid), 1000)) === true;
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

  test("past the output bound on stdout, the check and the child it left are killed, and the result says so", async () => {
    const dir = script(
      "big",
      "sleep 30 &\necho $! > child.pid\ni=0\nwhile [ $i -lt 400 ]; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done\nwait",
    );
    const result = await boundedCheckRunner(process.env, 1024).run("big", dir, 20_000);
    expect([
      result.tooLarge,
      result.output.length <= 1024 + 64 * 1024,
      await childGone(dir),
    ]).toEqual([true, true, true]);
  });

  test("stderr counts toward the bound too: a check that floods it is stopped, not left to its time limit", async () => {
    const dir = script(
      "flood",
      "sleep 30 &\necho $! > child.pid\ni=0\nwhile [ $i -lt 400 ]; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx >&2; i=$((i+1)); done\nwait",
    );
    const result = await boundedCheckRunner(process.env, 1024).run("flood", dir, 3000);
    expect([result.tooLarge, result.timedOut ?? false, await childGone(dir)]).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("the caller's signal kills the check and its tree", async () => {
    const dir = script("slow", "sleep 30 &\necho $! > child.pid\nwait");
    const stop = new AbortController();
    const running = boundedCheckRunner(process.env).run("slow", dir, 20_000, stop.signal);
    await poll(() => existsSync(join(dir, "child.pid")), 3000);
    stop.abort();
    const result = await running;
    expect([result.aborted, await childGone(dir)]).toEqual([true, true]);
  });

  // A process that left the group (setsid) keeps the pipes open after the kill: the runner gives
  // the readers a short grace (2 s), then stops reading, instead of waiting the 8 s it lives.
  test.skipIf(!whichOnPath("setsid"))(
    "after the kill, a process that left the group does not hold the runner",
    async () => {
      const dir = script("escapes", "setsid sleep 8 &\necho $! > child.pid\nsleep 8");
      const started = Date.now();
      const result = await boundedCheckRunner(process.env).run("escapes", dir, 300);
      children.push(Number(readFileSync(join(dir, "child.pid"), "utf8").trim()));
      expect([result.timedOut, Date.now() - started < 6000]).toEqual([true, true]);
    },
  );

  test("a check that fails gives its exit code and its whole output, stdout then stderr", async () => {
    const dir = script("fails", "echo out\necho err >&2\nexit 3");
    const result = await boundedCheckRunner(process.env).run("fails", dir, 5000);
    expect([result.exitCode, result.output]).toEqual([3, "out\nerr\n"]);
  });
});

/**
 * The failure paths of `runLimited`, through its spawn seam: a pipe that fails cannot be provoked
 * with a real process. The call gives back exactly what was thrown, and leaves no timer or listener
 * that would kill a pid later.
 */
describe("check-loop: runLimited when reading fails", () => {
  const stream = (fail?: { value: unknown }) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (fail) controller.error(fail.value);
        else controller.close();
      },
    });
  function fakeSpawn(fail: { stdout?: { value: unknown }; stderr?: { value: unknown } }) {
    return () => ({
      pid: 4242,
      stdout: stream(fail.stdout),
      stderr: stream(fail.stderr),
      exited: Promise.resolve(0),
      kill: () => {},
    });
  }
  async function outcome(fail: Parameters<typeof fakeSpawn>[0]) {
    const kills: number[] = [];
    const stop = new AbortController();
    let thrown: unknown = "nothing thrown";
    try {
      await runLimited(["x"], "/", 1024, 50, async (pid) => void kills.push(pid), {
        signal: stop.signal,
        spawn: fakeSpawn(fail),
      });
    } catch (error) {
      thrown = error;
    }
    const atEnd = kills.length;
    // With the signal fired, and past the 50 ms time limit: no kill armed by the call comes.
    stop.abort();
    await poll(() => kills.length > atEnd, 150);
    return { thrown, atEnd, later: kills.length - atEnd };
  }

  test("a stdout read that fails kills the tree once, rethrows what was thrown even when falsy, and leaves nothing armed", async () => {
    const sentinel = { reason: "pipe" };
    expect([
      await outcome({ stdout: { value: sentinel } }),
      await outcome({ stdout: { value: 0 } }),
    ]).toEqual([
      { thrown: sentinel, atEnd: 1, later: 0 },
      { thrown: 0, atEnd: 1, later: 0 },
    ]);
  });

  test("a stderr read that fails is thrown too, with the time limit's timer and the listener cleared", async () => {
    const sentinel = { reason: "stderr" };
    expect(await outcome({ stderr: { value: sentinel } })).toEqual({
      thrown: sentinel,
      atEnd: 0,
      later: 0,
    });
  });
});
