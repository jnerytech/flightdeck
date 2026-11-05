// Fake CLIs never outlive the run (issue #254): 83 orphaned fake gh calls once held 11.6 GB.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeRule, installFakeCli, reapFakes } from "./fake-cli.ts";
import { pidAlive } from "./temp-run.ts";

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

/** Waits until `check` holds or `ms` pass; whether it held. */
async function within(ms: number, check: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(25);
  }
  return check();
}

/** Starts the fake from a short-lived bun parent that exits at once; the fake's pid. */
async function orphanedFake(dir: string): Promise<number> {
  const parent = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const c = Bun.spawn([process.execPath, ${JSON.stringify(MAIN)}, ${JSON.stringify(dir)}, "auth", "login"], { stdio: ["ignore", "ignore", "ignore"] }); console.log(c.pid); process.exit(0);`,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const pid = Number((await new Response(parent.stdout).text()).trim());
  await parent.exited;
  started.push(pid);
  return pid;
}

describe("fake-orphans", () => {
  test("a fake whose caller is gone stops waiting within a second", async () => {
    const dir = fakeDir([WAITING]);
    const pid = await orphanedFake(dir);
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
    const pid = await orphanedFake(dir);
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

  test.skipIf(process.platform !== "linux")(
    "at the end of a run the leftover fakes are killed, and a reused pid is left alone",
    async () => {
      // A run folder of this test's own, so the sweep never reaches another test's fakes.
      const run = mkdtempSync(join(tmpdir(), "fd-reap-"));
      const before = process.env.TMPDIR;
      process.env.TMPDIR = run;
      let dir: string;
      let staleDir: string;
      try {
        dir = fakeDir([WAITING]);
        staleDir = fakeDir([]);
      } finally {
        process.env.TMPDIR = before;
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
      expect(reapFakes(run)).toEqual([fake.pid]);
      expect(await within(1500, () => !pidAlive(fake.pid))).toBe(true);
      expect(pidAlive(other.pid)).toBe(true);
    },
  );
});
