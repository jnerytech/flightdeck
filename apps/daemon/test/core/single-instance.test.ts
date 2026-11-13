import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AlreadyRunningError,
  acquireLock,
  LOCK_FILE,
  readLockPid,
  withLock,
} from "../../src/kernel/lock.ts";
import { type CliDeps, runCli, startDaemon } from "../../src/main.ts";
import { tempDir } from "../support/helpers.ts";

function config() {
  const dir = tempDir();
  const dataDir = join(dir, "data");
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ port: 0, token: "t".repeat(32), dataDir }));
  return { file, dataDir };
}

function deps() {
  const exits: number[] = [];
  const errors: string[] = [];
  const cli: CliDeps = {
    env: {},
    log: { log: () => {}, error: (m) => errors.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
  };
  return { cli, exits, errors };
}

describe("instancia-unica", () => {
  test("segundo daemon com o mesmo dataDir sai com código 3", async () => {
    const { file } = config();
    const first = deps();
    const daemon = await runCli(["--config", file, "--runtime", "fake"], first.cli);
    expect(daemon).not.toBeNull();

    const second = deps();
    expect(await runCli(["--config", file, "--runtime", "fake"], second.cli)).toBeNull();
    expect(second.exits).toEqual([3]);
    expect(second.errors.join("\n")).toContain("already running");

    await daemon?.stop();
    const third = deps();
    const again = await runCli(["--config", file, "--runtime", "fake"], third.cli);
    expect(third.exits).toEqual([]);
    await again?.stop();
  });

  test("lock de um processo que já morreu é retomado", async () => {
    const { dataDir } = config();
    const dead = Bun.spawn([process.execPath, "-e", "0"]);
    await dead.exited;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), String(dead.pid));

    const lock = await acquireLock(dataDir);
    expect(lock).not.toBeNull();
    expect(await acquireLock(dataDir)).toBeNull();
    await lock?.release();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    await lock?.release();
  });

  test("lock com conteúdo ilegível é tratado como abandonado", async () => {
    const { dataDir } = config();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), "lixo");
    const lock = await acquireLock(dataDir);
    expect(lock).not.toBeNull();
    await lock?.release();
  });

  test("releasing a lock whose file is already gone succeeds, so it never hides the error before it (#1676)", async () => {
    const { dataDir } = config();
    const lock = await acquireLock(dataDir);
    rmSync(join(dataDir, LOCK_FILE));
    const released = await lock?.release().then(
      () => "released",
      (error: unknown) => String(error),
    );
    expect(released).toBe("released");
  });

  test("taking, reading and releasing the lock never block: each returns a promise", async () => {
    const { dataDir } = config();
    const taking = acquireLock(dataDir);
    expect(taking).toBeInstanceOf(Promise);
    const lock = await taking;
    const reading = readLockPid(dataDir);
    expect(reading).toBeInstanceOf(Promise);
    expect(await reading).toBe(process.pid);
    const releasing = lock?.release();
    expect(releasing).toBeInstanceOf(Promise);
    await releasing;
    expect(await readLockPid(dataDir)).toBeNull();
  });
});

async function deadPid(): Promise<number> {
  const dead = Bun.spawn([process.execPath, "-e", "0"]);
  await dead.exited;
  return dead.pid;
}

describe("lock: takeover and release (issue #1677)", () => {
  test("two callers racing for the same stale lock: exactly one takes it", async () => {
    const pid = await deadPid();
    for (let round = 0; round < 20; round++) {
      const { dataDir } = config();
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, LOCK_FILE), String(pid));
      const locks = await Promise.all([acquireLock(dataDir), acquireLock(dataDir)]);
      expect(
        locks.filter((lock) => lock !== null),
        `round ${round}`,
      ).toHaveLength(1);
      await locks.find((lock) => lock !== null)?.release();
    }
  });

  test("many callers racing for one stale lock: exactly one takes it, and no helper file is left", async () => {
    const pid = await deadPid();
    for (let round = 0; round < 150; round++) {
      const { dataDir } = config();
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, LOCK_FILE), String(pid));
      const locks = await Promise.all(Array.from({ length: 5 }, () => acquireLock(dataDir)));
      expect(
        locks.filter((lock) => lock !== null),
        `round ${round}`,
      ).toHaveLength(1);
      await locks.find((lock) => lock !== null)?.release();
      expect(readdirSync(dataDir), `round ${round}`).toEqual([]);
    }
  });

  test("a takeover guard left by a process that died does not block the next takeover", async () => {
    const { dataDir } = config();
    mkdirSync(dataDir, { recursive: true });
    const dead = String(await deadPid());
    writeFileSync(join(dataDir, LOCK_FILE), dead);
    writeFileSync(join(dataDir, `${LOCK_FILE}.takeover`), dead);
    const lock = await acquireLock(dataDir);
    expect(lock).not.toBeNull();
    expect(readFileSync(join(dataDir, LOCK_FILE), "utf8")).toBe(String(process.pid));
    await lock?.release();
    expect(readdirSync(dataDir)).toEqual([]);
  });

  test("release leaves a lock that now holds another pid", async () => {
    const { dataDir } = config();
    const lock = await acquireLock(dataDir);
    const path = join(dataDir, LOCK_FILE);
    writeFileSync(path, String(await deadPid()));
    await lock?.release();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).not.toBe(String(process.pid));
  });

  test("withLock runs fn under the lock, returns its value and takes the lock off", async () => {
    const { dataDir } = config();
    const path = join(dataDir, LOCK_FILE);
    const seen = await withLock(dataDir, "hint", async () => existsSync(path));
    expect(seen).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  test("withLock takes the lock off when fn throws, and the error reaches the caller", async () => {
    const { dataDir } = config();
    const path = join(dataDir, LOCK_FILE);
    let heldInside = false;
    await expect(
      withLock(dataDir, "hint", async () => {
        heldInside = existsSync(path);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(heldInside).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  test("withLock refuses while a live process holds the lock: fn never runs, the hint is in the error", async () => {
    const { dataDir } = config();
    const held = await acquireLock(dataDir);
    let ran = false;
    const refused = withLock(dataDir, "stop the daemon first", async () => {
      ran = true;
    });
    await expect(refused).rejects.toBeInstanceOf(AlreadyRunningError);
    await expect(refused).rejects.toThrow("stop the daemon first");
    expect(ran).toBe(false);
    // The refused call must not have taken the holder's lock away.
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(true);
    await held?.release();
  });
});

describe("startDaemon: a failed boot gives the lock back (issue #1677)", () => {
  test("a corrupt flightdeck.db makes it throw and leaves no lock file", async () => {
    const { file, dataDir } = config();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "flightdeck.db"), "this is not a database file ".repeat(100));
    await expect(
      startDaemon(
        { command: "start", config: file, runtime: "fake" },
        {},
        { log: () => {}, error: () => {} },
      ),
    ).rejects.toThrow();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  });
});
