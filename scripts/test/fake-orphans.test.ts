// Fake CLIs never outlive the run (issue #254): 83 orphaned fake gh calls once held 11.6 GB.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FakeRule, fakeCaller, installFakeCli, reapFakes } from "./fake-cli.ts";
import { realTempDir } from "./temp-dir.ts";
import { pidAlive, within } from "./temp-run.ts";

const MAIN = join(import.meta.dir, "fake-cli-main.ts");
const WAITING: FakeRule = { args: ["auth", "login"], stderr: "code\n", delayMs: 30_000 };

/** Every pid a test started, killed at the end whatever the test found. */
const started: number[] = [];
afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone already: what the test wanted.
    }
  }
});

/** A fake's state folder with these rules, off PATH (the tests start fake-cli-main.ts directly). */
function fakeDir(rules: FakeRule[]): string {
  const fake = installFakeCli("gh", rules, {});
  return fake.dir;
}

/** The pids a fake recorded for itself and its children. */
const recorded = (dir: string) =>
  existsSync(join(dir, "pids")) ? readdirSync(join(dir, "pids")).map(Number) : [];

/**
 * Starts the fake from a short-lived bun parent, which exits once the fake is going: once the fake
 * recorded its pid (`started`), or once the fake itself ended (`ended`, for a pipe holder it leaves
 * behind). The fake's pid.
 */
async function orphanedFake(dir: string, until: "started" | "ended"): Promise<number> {
  const spawn = `const c = Bun.spawn([process.execPath, ${JSON.stringify(MAIN)}, ${JSON.stringify(dir)}, "auth", "login"], { stdio: ["ignore", "ignore", "ignore"] });`;
  const done = "console.log(c.pid); process.exit(0);";
  const wait =
    until === "ended"
      ? `await c.exited; ${done}`
      : // At most 3 s: a fake that never records must not keep this parent looking.
        `const end = Date.now() + 3000; setInterval(() => { if (Date.now() > end || require("node:fs").existsSync(${JSON.stringify(join(dir, "pids"))} + "/" + c.pid)) { ${done} } }, 10);`;
  const parent = Bun.spawn([process.execPath, "-e", `${spawn} ${wait}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const pid = Number((await new Response(parent.stdout).text()).trim());
  await parent.exited;
  started.push(pid);
  return pid;
}

describe("fake-orphans", () => {
  test("a fake watches the caller its shell shim handed over, except on Windows, where Git Bash's $PPID is not a Windows pid (#392)", () => {
    expect(fakeCaller({ FLIGHTDECK_FAKE_CALLER: "4321" }, "linux", 77)).toBe(4321);
    expect(fakeCaller({ FLIGHTDECK_FAKE_CALLER: "4321" }, "darwin", 77)).toBe(4321);
    expect(fakeCaller({ FLIGHTDECK_FAKE_CALLER: "4321" }, "win32", 77)).toBe(77);
    expect(fakeCaller({}, "linux", 77)).toBe(77);
    expect(fakeCaller({ FLIGHTDECK_FAKE_CALLER: "x" }, "linux", 77)).toBe(77);
  });

  test("a fake whose caller is gone stops waiting within a second", async () => {
    const dir = fakeDir([WAITING]);
    const pid = await orphanedFake(dir, "started");
    expect(await within(1500, () => !pidAlive(pid))).toBe(true);
  });

  test("a fake never lives past its deadline, even with its caller alive", async () => {
    const dir = fakeDir([WAITING]);
    const proc = Bun.spawn([process.execPath, MAIN, dir, "auth", "login"], {
      env: { ...process.env, FLIGHTDECK_FAKE_MAX_MS: "300" },
      stdout: "ignore",
      stderr: "ignore",
    });
    started.push(proc.pid);
    expect(await within(2000, () => !pidAlive(proc.pid))).toBe(true);
  });

  test("a fake records its pid while it runs, and its pipe holder's, and the holder stops with the caller", async () => {
    const dir = fakeDir([{ ...WAITING, delayMs: 0, holdPipesMs: 30_000 }]);
    const pid = await orphanedFake(dir, "ended");
    expect(await within(1500, () => recorded(dir).some((p) => p !== pid))).toBe(true);
    const holder = recorded(dir).find((p) => p !== pid) ?? 0;
    started.push(holder);
    expect(await within(1500, () => !pidAlive(holder))).toBe(true);
  });

  test("a fake that ends on its own leaves no pid behind", async () => {
    const dir = fakeDir([{ args: ["auth", "status"], stdout: "ok\n" }]);
    const proc = Bun.spawn([process.execPath, MAIN, dir, "auth", "status"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await proc.exited).toBe(0);
    expect(recorded(dir)).toEqual([]);
    expect(existsSync(join(dir, "pids"))).toBe(true);
  });

  test("at the end of a run the leftover fakes are killed, and a reused pid is left alone (on Linux; elsewhere nothing is swept)", async () => {
    // A run folder of this test's own, so the sweep never reaches another test's fakes.
    const run = realTempDir("fd-reap-");
    // os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows (#392): point all three at it.
    const vars = ["TMPDIR", "TEMP", "TMP"] as const;
    const before = vars.map((name) => process.env[name]);
    for (const name of vars) process.env[name] = run;
    let dir: string;
    let staleDir: string;
    try {
      dir = fakeDir([WAITING]);
      staleDir = fakeDir([]);
    } finally {
      vars.forEach((name, i) => {
        if (before[i] === undefined) delete process.env[name];
        else process.env[name] = before[i];
      });
    }
    expect(dir.startsWith(run)).toBe(true);
    const fake = Bun.spawn([process.execPath, MAIN, dir, "auth", "login"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    started.push(fake.pid);
    expect(await within(1500, () => recorded(dir).includes(fake.pid))).toBe(true);
    // Another program behind a pid file, as when a dead fake's pid was reused.
    const other = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    started.push(other.pid);
    const stale = join(staleDir, "pids");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, String(other.pid)), "");
    // Only Linux has /proc to tell a fake from a reused pid; elsewhere the watch and the
    // deadline end the fakes, and the sweep leaves everything alone.
    if (process.platform !== "linux") {
      expect(reapFakes(run)).toEqual([]);
      expect(pidAlive(fake.pid)).toBe(true);
      return;
    }
    expect(reapFakes(run)).toEqual([fake.pid]);
    expect(await within(1500, () => !pidAlive(fake.pid))).toBe(true);
    expect(pidAlive(other.pid)).toBe(true);
  });
});
