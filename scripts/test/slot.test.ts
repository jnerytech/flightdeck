import { describe, expect, test } from "bun:test";
import {
  acquire,
  cancel,
  DEFAULT_MAX_AGE_MS,
  describeHolder,
  LONG_HOLD_MS,
  lowerOthers,
  POLL_MS,
  type ProcessInfo,
  parseArgs,
  parseHolder,
  RENICE_MS,
  release,
  run,
  type SlotChild,
  type SlotEnv,
  type SlotHolder,
  status,
  testFileCount,
  tryAcquire,
  USAGE,
} from "../lib/slot.ts";

const PATH = "/tmp/flightdeck-slot.lock";
const mine: SlotHolder = { pid: 10, label: "sonar", command: "bun run test", startedAt: 1000 };
const theirs: SlotHolder = { pid: 20, label: "kiwi", command: "bun run e2e", startedAt: 1000 };

/** An in-memory slot: one lock "file", a fake clock that only moves when somebody sleeps. */
function fake(
  opts: {
    files?: Record<string, string>;
    dead?: number[];
    child?: SlotChild;
    holder?: number;
  } = {},
) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const logs: string[] = [];
  const sleeps: number[] = [];
  const terminated: number[] = [];
  const spawned: { command: string[]; nice: boolean }[] = [];
  const spawnedAsHolder: Array<boolean | undefined> = [];
  /** protect and spawn, in the order they were called. */
  const order: string[] = [];
  let time = 5000;
  let handler: ((code: number) => void) | null = null;
  const listeners = { off: 0 };
  const onSleep: ((n: number) => void)[] = [];
  const env: SlotEnv = {
    fs: {
      create: (p, d) => {
        if (files.has(p)) return false;
        files.set(p, d);
        return true;
      },
      read: (p) => files.get(p) ?? null,
      remove: (p) => {
        files.delete(p);
      },
      list: (prefix) => [...files.keys()].filter((name) => name.startsWith(prefix)),
    },
    path: PATH,
    pid: 10,
    label: "sonar",
    alive: (pid) => !(opts.dead ?? []).includes(pid),
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
      for (const f of onSleep) f(sleeps.length);
    },
    log: (line) => {
      logs.push(line);
    },
    ...(opts.holder !== undefined ? { holder: opts.holder } : {}),
    protect: () => {
      order.push("protect");
    },
    spawn: (command, nice, asHolder) => {
      order.push("spawn");
      spawned.push({ command, nice });
      spawnedAsHolder.push(asHolder);
      return opts.child ?? { wait: async () => 0, kill: () => {} };
    },
    terminate: (pid) => {
      terminated.push(pid);
    },
    onSignal: (h) => {
      handler = h;
      return () => {
        listeners.off += 1;
        handler = null;
      };
    },
  };
  return {
    env,
    files,
    logs,
    sleeps,
    spawned,
    spawnedAsHolder,
    order,
    terminated,
    listeners,
    onSleep,
    signal: (code: number) => handler?.(code),
  };
}

const held = (h: SlotHolder) => JSON.stringify(h);

describe("slot: arguments", () => {
  test("the command after -- runs, with --nice before it", () => {
    expect(parseArgs(["--", "bun", "run", "test"])).toEqual({
      kind: "run",
      nice: false,
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      command: ["bun", "run", "test"],
    });
    expect(parseArgs(["--nice", "bun", "test"])).toEqual({
      kind: "run",
      nice: true,
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      command: ["bun", "test"],
    });
    expect(parseArgs(["--", "--nice", "--", "bun"])).toEqual({
      kind: "run",
      nice: true,
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      command: ["--", "bun"],
    });
  });

  test("--status alone is the status; nothing to run is the usage", () => {
    expect(parseArgs(["--status"])).toEqual({ kind: "status", maxAgeMs: DEFAULT_MAX_AGE_MS });
    expect(parseArgs(["--", "--status"])).toEqual({ kind: "status", maxAgeMs: DEFAULT_MAX_AGE_MS });
    expect(parseArgs(["--status", "bun"])).toEqual({ kind: "usage" });
    expect(parseArgs([])).toEqual({ kind: "usage" });
    expect(parseArgs(["--"])).toEqual({ kind: "usage" });
    expect(parseArgs(["--nice"])).toEqual({ kind: "usage" });
  });
});

describe("slot: the max age", () => {
  test("--max-age takes minutes, before the command or with --status, in any order with --nice", () => {
    expect(parseArgs(["--max-age", "30", "--nice", "bun", "test"])).toEqual({
      kind: "run",
      nice: true,
      maxAgeMs: 30 * 60_000,
      command: ["bun", "test"],
    });
    expect(parseArgs(["--nice", "--max-age", "5", "bun"])).toMatchObject({ maxAgeMs: 300_000 });
    expect(parseArgs(["--status", "--max-age", "10"])).toEqual({
      kind: "status",
      maxAgeMs: 600_000,
    });
  });

  test("a missing, zero, negative or non-numeric age is the usage", () => {
    for (const bad of ["0", "-5", "soon", "1.5x", ""]) {
      expect(parseArgs(["--max-age", bad, "bun"])).toEqual({ kind: "usage" });
    }
    expect(parseArgs(["--max-age"])).toEqual({ kind: "usage" });
  });

  const OLD = 1000 + 91 * 60_000;

  test("--status warns about a live holder older than the max age, and still names it", () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.env.now = () => OLD;
    expect(status(f.env)).toBe(
      "held by kiwi: bun run e2e (pid 20, 1h 31m); WARNING: older than 90m, check if it is stuck",
    );
    // Under its own max age a holder past 20 minutes is still LONG (#833).
    expect(status(f.env, 120 * 60_000)).toBe(
      "held by kiwi: bun run e2e (pid 20, 1h 31m); LONG: over 20m",
    );
  });

  test("a dead holder is stale, not old", () => {
    const f = fake({ files: { [PATH]: held(theirs) }, dead: [20] });
    f.env.now = () => OLD;
    expect(status(f.env)).toBe("free (stale lock of pid 20)");
  });

  test("a waiter warns once about an old holder and keeps waiting without taking the slot", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.env.now = () => OLD;
    let stop = 0;
    expect(await acquire(f.env, "x", () => stop++ >= 3)).toBe(false);
    expect(f.logs).toEqual([
      "slot busy: kiwi: bun run e2e (pid 20, 1h 31m); waiting",
      "slot warning: kiwi (pid 20) has held the slot for over 90m: check if it is stuck; not taking it over",
    ]);
    expect(f.files.get(PATH)).toBe(held(theirs));
  });

  test("a waiter uses its own max age", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.env.now = () => 1000 + 120_000;
    let stop = 0;
    expect(await acquire(f.env, "x", () => stop++ >= 1, 60_000)).toBe(false);
    expect(f.logs[1]).toContain("over 1m");
  });
});

describe("slot: the holder", () => {
  test("a lock file reads back to its holder; anything else is no holder", () => {
    expect(parseHolder(held(theirs))).toEqual(theirs);
    expect(parseHolder(null)).toBeNull();
    expect(parseHolder("")).toBeNull();
    expect(parseHolder("{not json")).toBeNull();
    expect(parseHolder("null")).toBeNull();
    expect(parseHolder(JSON.stringify({ ...theirs, pid: "20" }))).toBeNull();
    expect(parseHolder(JSON.stringify({ ...theirs, label: 3 }))).toBeNull();
    expect(parseHolder(JSON.stringify({ ...theirs, command: null }))).toBeNull();
    expect(parseHolder(JSON.stringify({ ...theirs, startedAt: "now" }))).toBeNull();
  });

  test("the description names the label, command, pid and how long it holds", () => {
    expect(describeHolder(theirs, 1000 + 45_000)).toBe("kiwi: bun run e2e (pid 20, 45s)");
    expect(describeHolder(theirs, 1000 + 185_000)).toBe("kiwi: bun run e2e (pid 20, 3m 5s)");
    expect(describeHolder(theirs, 1000 + 3_725_000)).toBe("kiwi: bun run e2e (pid 20, 1h 2m)");
    expect(describeHolder(theirs, 500)).toBe("kiwi: bun run e2e (pid 20, 0s)");
  });
});

describe("slot: taking and giving back the lock", () => {
  test("a free slot is taken, with who, what and since when written down", () => {
    const f = fake();
    expect(tryAcquire(f.env, "bun run test")).toEqual({ acquired: true, holder: null });
    expect(parseHolder(f.files.get(PATH) ?? null)).toEqual({
      pid: 10,
      label: "sonar",
      command: "bun run test",
      startedAt: 5000,
    });
  });

  test("a slot held by a live process is not taken, and the holder is named", () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    expect(tryAcquire(f.env, "x")).toEqual({ acquired: false, holder: theirs });
    expect(f.files.get(PATH)).toBe(held(theirs));
  });

  test("the lock of a dead process is removed and the slot is taken", () => {
    const f = fake({ files: { [PATH]: held(theirs) }, dead: [20] });
    expect(tryAcquire(f.env, "x").acquired).toBe(true);
    expect(parseHolder(f.files.get(PATH) ?? null)?.pid).toBe(10);
  });

  test("a lock file nobody can read is stale", () => {
    const f = fake({ files: { [PATH]: "garbage" } });
    expect(tryAcquire(f.env, "x").acquired).toBe(true);
    expect(parseHolder(f.files.get(PATH) ?? null)?.pid).toBe(10);
  });

  test("losing the race for a stale lock leaves the winner's lock alone", () => {
    const f = fake({ files: { [PATH]: held(theirs) }, dead: [20] });
    const read = f.env.fs.read;
    let reads = 0;
    f.env.fs.read = (p) => {
      reads += 1;
      // Between the check and the removal, somebody else cleaned it and took the slot.
      if (reads === 2) f.files.set(p, held({ ...theirs, pid: 30 }));
      return read(p);
    };
    expect(tryAcquire(f.env, "x")).toEqual({
      acquired: false,
      holder: { ...theirs, pid: 30 },
    });
    expect(parseHolder(f.files.get(PATH) ?? null)?.pid).toBe(30);
  });

  test("release removes only a lock this process wrote", () => {
    const own = fake({ files: { [PATH]: held(mine) } });
    release(own.env);
    expect(own.files.has(PATH)).toBe(false);

    const other = fake({ files: { [PATH]: held(theirs) } });
    release(other.env);
    expect(other.files.get(PATH)).toBe(held(theirs));

    const none = fake();
    release(none.env);
    expect(none.files.size).toBe(0);
  });
});

describe("slot: waiting in the queue", () => {
  test("it waits, names the holder once, and takes the slot when it is freed", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.onSleep.push((n) => {
      if (n === 3) f.files.delete(PATH);
    });
    expect(await acquire(f.env, "bun run test", () => false)).toBe(true);
    expect(f.sleeps).toEqual([POLL_MS, POLL_MS, POLL_MS]);
    expect(f.logs).toEqual(["slot busy: kiwi: bun run e2e (pid 20, 4s); waiting"]);
    expect(parseHolder(f.files.get(PATH) ?? null)?.pid).toBe(10);
  });

  test("a new holder is named again", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.onSleep.push((n) => {
      if (n === 1) f.files.set(PATH, held({ ...theirs, pid: 21, label: "tbug" }));
      if (n === 2) f.files.delete(PATH);
    });
    expect(await acquire(f.env, "x", () => false)).toBe(true);
    expect(f.logs).toHaveLength(2);
    expect(f.logs[1]).toContain("tbug");
  });

  test("a lock that appears and goes within one turn is waited out without a name", async () => {
    const f = fake();
    let first = true;
    const create = f.env.fs.create;
    f.env.fs.create = (p, d) => {
      if (first && p === PATH) {
        first = false;
        return false;
      }
      return create(p, d);
    };
    expect(await acquire(f.env, "x", () => false)).toBe(true);
    expect(f.logs).toEqual([]);
    expect(f.sleeps).toEqual([POLL_MS]);
  });

  test("a stop request ends the wait without the slot", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    let stop = false;
    f.onSleep.push(() => {
      stop = true;
    });
    expect(await acquire(f.env, "x", () => stop)).toBe(false);
    expect(f.files.get(PATH)).toBe(held(theirs));
  });
});

describe("slot: status", () => {
  test("it says who holds the slot, or that it is free", () => {
    expect(status(fake({ files: { [PATH]: held(theirs) } }).env)).toBe(
      "held by kiwi: bun run e2e (pid 20, 4s)",
    );
    expect(status(fake().env)).toBe("free");
    expect(status(fake({ files: { [PATH]: held(theirs) }, dead: [20] }).env)).toBe(
      "free (stale lock of pid 20)",
    );
    expect(status(fake({ files: { [PATH]: "garbage" } }).env)).toBe("free (stale lock)");
  });
});

const queued = (pid: number, label: string, startedAt: number, command = "bun run test") =>
  JSON.stringify({ pid, label, command, startedAt } satisfies SlotHolder);

describe("slot: first come, first served (#372)", () => {
  test("a free slot waits for a live waiter that queued earlier, and is taken once it is gone", async () => {
    const f = fake({ files: { [`${PATH}.wait.30`]: queued(30, "userhome", 2000) } });
    const lockDuringWait: boolean[] = [];
    f.onSleep.push((n) => {
      lockDuringWait.push(f.files.has(PATH));
      if (n === 2) f.files.delete(`${PATH}.wait.30`);
    });
    expect(await acquire(f.env, "bun run e2e", () => false)).toBe(true);
    expect(lockDuringWait).toEqual([false, false]);
    expect(f.sleeps).toEqual([POLL_MS, POLL_MS]);
    expect(f.logs).toEqual([
      "slot queue: 1 waiting before you (first: userhome: bun run test (pid 30, 3s)); waiting",
    ]);
    expect(parseHolder(f.files.get(PATH) ?? null)?.pid).toBe(10);
  });

  test("an equal queue time goes to the lower pid", async () => {
    const before = fake({ files: { [`${PATH}.wait.5`]: queued(5, "top-bar", 5000) } });
    let stop = false;
    before.onSleep.push(() => {
      stop = true;
    });
    expect(await acquire(before.env, "x", () => stop)).toBe(false);
    expect(before.files.has(PATH)).toBe(false);

    const after = fake({ files: { [`${PATH}.wait.15`]: queued(15, "top-bar", 5000) } });
    expect(await acquire(after.env, "x", () => false)).toBe(true);
    expect(after.sleeps).toEqual([]);
  });

  test("a dead or unreadable waiter, and one that queued later, hold nobody back", async () => {
    const f = fake({
      files: {
        [`${PATH}.wait.31`]: queued(31, "gone", 1000),
        [`${PATH}.wait.32`]: "garbage",
        [`${PATH}.wait.33`]: queued(33, "later", 9000),
      },
      dead: [31],
    });
    expect(await acquire(f.env, "x", () => false)).toBe(true);
    expect(f.sleeps).toEqual([]);
    expect(f.logs).toEqual([]);
  });

  test("--status lists the live waiters in queue order with their ages, each once", () => {
    const long = `bun test ${"./apps/daemon/test/a.test.ts ".repeat(10)}`.trim();
    const files = {
      [`${PATH}.wait.40`]: queued(40, "top-bar", 3000),
      [`${PATH}.wait.30`]: queued(30, "userhome", 2000, long),
      [`${PATH}.wait.30.30`]: queued(30, "userhome", 2000, long),
      [`${PATH}.wait.31`]: queued(31, "gone", 1000),
    };
    const clipped = `${long.slice(0, 80)}…`;
    expect(status(fake({ files: { ...files, [PATH]: held(theirs) }, dead: [31] }).env)).toBe(
      [
        "held by kiwi: bun run e2e (pid 20, 4s)",
        `waiting 1: userhome: ${clipped} (pid 30, 3s); waits on kiwi (pid 20)`,
        "waiting 2: top-bar: bun run test (pid 40, 2s); waits on kiwi (pid 20)",
      ].join("\n"),
    );
    expect(status(fake({ files, dead: [31] }).env)).toBe(
      [
        "free",
        `waiting 1: userhome: ${clipped} (pid 30, 3s)`,
        "waiting 2: top-bar: bun run test (pid 40, 2s)",
      ].join("\n"),
    );
  });
});

describe("slot: running a command", () => {
  test("the command runs under the lock and its exit code comes back", async () => {
    const f = fake({ child: { wait: async () => 7, kill: () => {} } });
    f.env.spawn = (command, nice) => {
      f.spawned.push({ command, nice });
      expect(parseHolder(f.files.get(PATH) ?? null)?.command).toBe("bun run test");
      return { wait: async () => 7, kill: () => {} };
    };
    expect(await run(f.env, ["--nice", "bun", "run", "test"])).toBe(7);
    expect(f.spawned).toEqual([{ command: ["bun", "run", "test"], nice: true }]);
    expect(f.files.has(PATH)).toBe(false);
    expect(f.listeners.off).toBe(1);
  });

  test("the lock is released when the command fails to start", async () => {
    const f = fake();
    f.env.spawn = () => {
      throw new Error("ENOENT");
    };
    await expect(run(f.env, ["nope"])).rejects.toThrow("ENOENT");
    expect(f.files.has(PATH)).toBe(false);
    expect(f.listeners.off).toBe(1);
  });

  test("--status prints the holder and runs nothing", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    expect(await run(f.env, ["--status"])).toBe(0);
    expect(f.logs).toEqual(["held by kiwi: bun run e2e (pid 20, 4s)"]);
    expect(f.spawned).toEqual([]);
  });

  test("--status logs the holder and each waiter as lines of their own, since a log line is kept to one line (#372)", async () => {
    const f = fake({
      files: {
        [PATH]: held(theirs),
        [`${PATH}.wait.30`]: JSON.stringify({
          ...theirs,
          pid: 30,
          label: "userhome",
          startedAt: 2000,
        }),
      },
    });
    expect(await run(f.env, ["--status"])).toBe(0);
    expect(f.logs).toEqual([
      "held by kiwi: bun run e2e (pid 20, 4s)",
      "waiting 1: userhome: bun run e2e (pid 30, 3s); waits on kiwi (pid 20)",
    ]);
  });

  test("no command prints the usage and exits with 2", async () => {
    const f = fake();
    expect(await run(f.env, [])).toBe(2);
    expect(f.logs).toEqual([USAGE]);
  });

  test("a signal while the command runs stops it, releases, and returns the signal's code", async () => {
    let killed = false;
    let finish: (code: number) => void = () => {};
    const child: SlotChild = {
      wait: () => new Promise<number>((resolve) => (finish = resolve)),
      kill: () => {
        killed = true;
        finish(1);
      },
    };
    const f = fake({ child });
    const done = run(f.env, ["bun", "test"]);
    await Promise.resolve();
    await Promise.resolve();
    f.signal(130);
    expect(await done).toBe(130);
    expect(killed).toBe(true);
    expect(f.files.has(PATH)).toBe(false);
  });

  test("a signal while queued gives up the wait without ever running", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.onSleep.push(() => f.signal(143));
    expect(await run(f.env, ["bun", "test"])).toBe(143);
    expect(f.spawned).toEqual([]);
    expect(f.files.get(PATH)).toBe(held(theirs));
    expect(f.listeners.off).toBe(1);
  });
});

const waiter = (pid: number, label: string) =>
  JSON.stringify({ pid, label, command: "bun run test", startedAt: 2000 } satisfies SlotHolder);

describe("slot: cancel", () => {
  test("--cancel alone is the cancel; with anything else it is the usage", () => {
    expect(parseArgs(["--cancel"])).toEqual({ kind: "cancel" });
    expect(parseArgs(["--", "--cancel"])).toEqual({ kind: "cancel" });
    expect(parseArgs(["--cancel", "bun"])).toEqual({ kind: "usage" });
    expect(parseArgs(["--nice", "--cancel"])).toEqual({ kind: "usage" });
  });

  test("a waiter is recorded while it waits and forgotten when it stops", async () => {
    const { env, files, onSleep } = fake({ files: { [PATH]: held(theirs) } });
    let during: string[] = [];
    onSleep.push((n) => {
      during = [...files.keys()].filter((name) => name.startsWith(`${PATH}.wait.`));
      if (n === 1) files.delete(PATH);
    });
    expect(await acquire(env, "bun run test", () => false)).toBe(true);
    expect(during).toEqual([`${PATH}.wait.10`]);
    expect([...files.keys()].some((name) => name.includes(".wait."))).toBe(false);
  });

  test("the recorded waiter names this process, label and command", async () => {
    const { env, files, onSleep } = fake({ files: { [PATH]: held(theirs) } });
    let recorded: SlotHolder | null = null;
    onSleep.push(() => {
      recorded = parseHolder(files.get(`${PATH}.wait.10`) ?? null);
      files.delete(PATH);
    });
    await acquire(env, "bun run e2e", () => false);
    expect(recorded).toMatchObject({ pid: 10, label: "sonar", command: "bun run e2e" });
  });

  test("it stops the own label's waiters and holder, never another label's", () => {
    const { env, files, logs, terminated } = fake({
      files: {
        [PATH]: held({ ...mine, pid: 11 }),
        [`${PATH}.wait.12`]: waiter(12, "sonar"),
        [`${PATH}.wait.20`]: waiter(20, "kiwi"),
      },
    });
    expect(cancel(env)).toBe(0);
    expect(terminated.sort()).toEqual([11, 12]);
    expect(files.has(`${PATH}.wait.20`)).toBe(true);
    expect(logs.join("\n")).toContain("cancelled sonar: bun run test (pid 12,");
    expect(logs.join("\n")).not.toContain("kiwi");
  });

  test("it never stops itself, a dead process or a holder of another label", () => {
    const { env, files, logs, terminated } = fake({
      dead: [13],
      files: {
        [PATH]: held(theirs),
        [`${PATH}.wait.10`]: waiter(10, "sonar"),
        [`${PATH}.wait.13`]: waiter(13, "sonar"),
      },
    });
    expect(cancel(env)).toBe(0);
    expect(terminated).toEqual([]);
    expect(files.has(`${PATH}.wait.13`)).toBe(false);
    expect(logs).toEqual(["nothing to cancel for sonar"]);
  });

  test("an unreadable waiter file is ignored and removed", () => {
    const { env, files, terminated } = fake({ files: { [`${PATH}.wait.14`]: "{broken" } });
    expect(cancel(env)).toBe(0);
    expect(terminated).toEqual([]);
    expect(files.has(`${PATH}.wait.14`)).toBe(false);
  });

  test("run with --cancel cancels", async () => {
    const { env, logs } = fake();
    expect(await run(env, ["--cancel"])).toBe(0);
    expect(logs).toEqual(["nothing to cancel for sonar"]);
  });
});

const proc = (pid: number, ppid: number, nice: number, command: string): ProcessInfo => ({
  pid,
  ppid,
  nice,
  command,
});

/** A process list with the slot's own tree (10 > 11 > 12) and other sessions' processes. */
const table = (): ProcessInfo[] => [
  proc(10, 1, 0, "bun scripts/slot.ts -- bun run test"),
  proc(11, 10, 0, "bun run test"),
  proc(12, 11, 0, "bun test --coverage"),
  proc(30, 1, 0, "bun --config=bunfig.area.toml test apps/daemon/test/a.test.ts"),
  proc(31, 1, 10, "/home/u/.bun/bin/bun test apps/daemon/test/b.test.ts"),
  proc(32, 1, 15, "bun test c"),
  proc(33, 1, 19, "bun test d"),
  proc(40, 1, 0, "node vite"),
  proc(41, 1, 0, "bun run lint"),
  proc(42, 1, 0, "bun x biome check"),
];

/** An env whose process table is live: reniced entries change, so a second pass finds them done. */
function withProcesses(list: ProcessInfo[], extra: Parameters<typeof fake>[0] = {}) {
  const f = fake(extra);
  const calls: Array<[number, number]> = [];
  let listed = 0;
  f.env.processes = async () => {
    listed++;
    return list.map((p) => ({ ...p }));
  };
  f.env.renice = (pid, nice) => {
    calls.push([pid, nice]);
    const target = list.find((p) => p.pid === pid);
    if (target) target.nice = nice;
  };
  return { ...f, calls, listed: () => listed };
}

describe("slot: --priority", () => {
  test("--priority is read before the command, with --nice or without", () => {
    expect(parseArgs(["--priority", "bun", "run", "test"])).toEqual({
      kind: "run",
      nice: false,
      priority: true,
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      command: ["bun", "run", "test"],
    });
    expect(parseArgs(["--nice", "--priority", "--", "bun"])).toEqual({
      kind: "run",
      nice: true,
      priority: true,
      maxAgeMs: DEFAULT_MAX_AGE_MS,
      command: ["--", "bun"],
    });
  });

  test("it raises the niceness of the other bun test processes, and only those", async () => {
    const f = withProcesses(table());
    expect(await lowerOthers(f.env)).toEqual([30, 31]);
    expect(f.calls).toEqual([
      [30, 15],
      [31, 15],
    ]);
  });

  test("a process already at 15 or more is never lowered, and a second pass changes nothing", async () => {
    const f = withProcesses(table());
    await lowerOthers(f.env);
    f.calls.length = 0;
    expect(await lowerOthers(f.env)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  test("a platform that cannot list or renice processes is left alone", async () => {
    const f = fake();
    expect(await lowerOthers(f.env)).toEqual([]);
  });

  test("a run with --priority lowers the others while the command runs, every RENICE_MS", async () => {
    const list = table();
    let ticks = 0;
    const f = withProcesses(list);
    const child: SlotChild = {
      wait: async () => {
        // Bounded: with no renicing loop the ticks never come and the command just ends.
        for (let i = 0; i < 50 && ticks < 3; i++) await new Promise((r) => setTimeout(r, 0));
        return 0;
      },
      kill: () => {},
    };
    f.env.spawn = () => child;
    // The fake sleep gives the child's timer a turn, so the loop cannot starve it.
    const sleep = f.env.sleep;
    f.env.sleep = async (ms) => {
      await sleep(ms);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    f.onSleep.push(() => {
      ticks++;
      // A new test process shows up in the second tick: it is caught in the third.
      if (ticks === 2) list.push(proc(50, 1, 0, "bun test e"));
    });
    expect(await run(f.env, ["--priority", "bun", "run", "test"])).toBe(0);
    expect(f.calls).toEqual([
      [30, 15],
      [31, 15],
      [50, 15],
    ]);
    expect(f.sleeps.filter((ms) => ms === RENICE_MS).length).toBeGreaterThanOrEqual(2);
  });

  test("a pass whose process listing fails is skipped, the next one still lowers the others, and the command's code is kept", async () => {
    const list = table();
    const f = withProcesses(list);
    const listing = f.env.processes as () => Promise<ProcessInfo[]>;
    let attempts = 0;
    f.env.processes = async () => {
      attempts++;
      if (attempts === 1) throw new Error("ps is not available right now");
      return listing();
    };
    const child: SlotChild = {
      wait: async () => {
        for (let i = 0; i < 50 && attempts < 2; i++) await new Promise((r) => setTimeout(r, 0));
        return 5;
      },
      kill: () => {},
    };
    f.env.spawn = () => child;
    const sleep = f.env.sleep;
    f.env.sleep = async (ms) => {
      await sleep(ms);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    expect(await run(f.env, ["--priority", "bun", "run", "test"])).toBe(5);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(f.calls).toEqual([
      [30, 15],
      [31, 15],
    ]);
  });

  test("a run without --priority never reads the process list", async () => {
    const f = withProcesses(table());
    expect(await run(f.env, ["bun", "run", "test"])).toBe(0);
    expect(f.listed()).toBe(0);
    expect(f.calls).toEqual([]);
  });
});

describe("slot: a command that runs under the slot may call the slot again", () => {
  test("the command is started as the holder, so what it starts itself can tell", async () => {
    const f = fake();
    await run(f.env, ["bun", "run", "test:related"]);
    expect(f.spawnedAsHolder).toEqual([true]);
  });

  test("under its holder's lock, a nested call runs the command at once and leaves the lock alone", async () => {
    const f = fake({
      files: { [PATH]: held(theirs) },
      holder: theirs.pid,
      child: { wait: async () => 3, kill: () => {} },
    });
    // Without the rule this would wait for a lock its own parent holds: end that wait, so it fails.
    f.onSleep.push(() => f.signal(143));
    expect(await run(f.env, ["--nice", "bun", "test", "x"])).toBe(3);
    expect(f.spawned).toEqual([{ command: ["bun", "test", "x"], nice: true }]);
    // It is not a holder of its own, and it queued and waited for nothing.
    expect(f.spawnedAsHolder).toEqual([false]);
    expect(f.files.get(PATH)).toBe(held(theirs));
    expect([...f.files.keys()]).toEqual([PATH]);
    expect(f.sleeps).toEqual([]);
    expect(f.logs).toEqual([]);
  });

  test("a holder variable left over from an old run does not skip the queue: the lock must name that pid", async () => {
    const other: SlotHolder = { ...theirs, pid: 30 };
    const f = fake({ files: { [PATH]: held(other) }, holder: theirs.pid });
    f.onSleep.push(() => f.signal(143));
    expect(await run(f.env, ["bun", "test", "x"])).toBe(143);
    expect(f.spawned).toEqual([]);
  });

  test("nor does the variable of a holder that is gone", async () => {
    const f = fake({ files: { [PATH]: held(theirs) }, holder: theirs.pid, dead: [theirs.pid] });
    expect(await run(f.env, ["bun", "test", "x"])).toBe(0);
    // The dead lock was stale: the slot was taken in the ordinary way.
    expect(f.spawnedAsHolder).toEqual([true]);
  });
});

describe("slot: the OOM killer's first choice (issue #247)", () => {
  test("the command is offered to the OOM killer before it starts, holding the slot or nested", async () => {
    const free = fake();
    expect(await run(free.env, ["--", "bun", "run", "test"])).toBe(0);
    expect(free.order).toEqual(["protect", "spawn"]);
    const nested = fake({ holder: 99, files: { [PATH]: held({ ...theirs, pid: 99 }) } });
    await run(nested.env, ["--", "bun", "test"]);
    expect(nested.order).toEqual(["protect", "spawn"]);
  });

  test("--status and the usage start nothing and change no score", async () => {
    const f = fake();
    await run(f.env, ["--status"]);
    await run(f.env, []);
    expect(f.order).toEqual([]);
  });
});

describe("slot: long holds and the test file limit (#833)", () => {
  const testFiles = (n: number) =>
    Array.from({ length: n }, (_, i) => `./apps/daemon/test/t${i}.test.ts`);
  /** What test:related starts through the slot above 60 files. */
  const related = (n: number) => [
    "bun",
    "--config=bunfig.area.toml",
    "test",
    "--timeout=15000",
    ...testFiles(n),
  ];
  type Logged = [string, string, { detail?: string; minutes?: number }];
  const recorder = (f: ReturnType<typeof fake>) => {
    const records: Logged[] = [];
    f.env.record = (rule, decision, extra) => {
      records.push([rule, decision, extra]);
    };
    return records;
  };

  test("testFileCount counts the test files a bun test command names, and nothing else", () => {
    expect(testFileCount(related(3))).toBe(3);
    expect(testFileCount(["bun", "test", "a.test.tsx", "b.spec.ts", "--bail"])).toBe(2);
    expect(testFileCount(["bun", "run", "test"])).toBe(0);
    expect(testFileCount(["bun", "run", "e2e", "a.test.ts"])).toBe(0);
    expect(testFileCount(["node", "test", "a.test.ts"])).toBe(0);
  });

  test("a run over 60 test files is refused before it queues, and the refusal is logged", async () => {
    const f = fake();
    const records = recorder(f);
    expect(await run(f.env, related(61))).toBe(2);
    expect(f.spawned).toEqual([]);
    expect(f.files.size).toBe(0);
    expect(f.logs.join("\n")).toContain("61 test files");
    expect(f.logs.join("\n")).toContain('FLIGHTDECK_SLOT_HEAVY="<reason>"');
    expect(records).toEqual([["slot-files", "block", {}]]);
    // A placeholder is no reason.
    const placeholder = fake();
    placeholder.env.heavyReason = "1";
    expect(await run(placeholder.env, related(61))).toBe(2);
    expect(placeholder.spawned).toEqual([]);
  });

  test("60 files, the full suite, and a run with a reason go through; the reason is logged", async () => {
    const f = fake();
    const records = recorder(f);
    expect(await run(f.env, related(60))).toBe(0);
    expect(await run(f.env, ["bun", "run", "test"])).toBe(0);
    expect(f.spawned).toHaveLength(2);
    expect(records).toEqual([]);
    const given = fake();
    const waived = recorder(given);
    given.env.heavyReason = "the release gate needs every daemon test";
    expect(await run(given.env, related(200))).toBe(0);
    expect(given.spawned).toHaveLength(1);
    expect(waived).toEqual([
      ["slot-files", "waived", { detail: "the release gate needs every daemon test" }],
    ]);
  });

  test("#865 review: a run nested under the holder is counted too, so `slot -- bun run test:related` cannot pass 60 files unseen", async () => {
    // The outer run (`bun run test:related`) names no file; the files come with the nested call.
    const f = fake({ files: { [PATH]: held(theirs) }, holder: 20 });
    const records = recorder(f);
    expect(await run(f.env, related(61))).toBe(2);
    expect(f.spawned).toEqual([]);
    expect(records).toEqual([["slot-files", "block", {}]]);
    const given = fake({ files: { [PATH]: held(theirs) }, holder: 20 });
    const waived = recorder(given);
    given.env.heavyReason = "the release gate needs every daemon test";
    expect(await run(given.env, related(61))).toBe(0);
    expect(given.spawned).toHaveLength(1);
    expect(waived.map(([rule, decision]) => [rule, decision])).toEqual([["slot-files", "waived"]]);
  });

  test("a hold past 20 minutes is logged with its minutes when the slot is given back, a stopped one too, a shorter one not", async () => {
    const cases: Array<[number, number, Logged[]]> = [
      [21, 0, [["long-hold", "allow", { minutes: 21, detail: "sonar: bun run e2e" }]]],
      [25, 143, [["long-hold", "allow", { minutes: 25, detail: "sonar: bun run e2e" }]]],
      [19, 0, []],
    ];
    for (const [minutes, code, expected] of cases) {
      let time = 5000;
      const child = {
        wait: async () => {
          time += minutes * 60_000;
          return code;
        },
        kill: () => {},
      };
      const f = fake({ child });
      f.env.now = () => time;
      const records = recorder(f);
      expect(await run(f.env, ["bun", "run", "e2e"])).toBe(code);
      expect(records).toEqual(expected);
    }
  });

  test("the holder's own output gets one LONG line at 20 minutes, with its waiters; the timer stops with the run", async () => {
    const timers: Array<{ ms: number; fn: () => void; cancelled: boolean }> = [];
    const child = {
      wait: async () => {
        timers[0]?.fn();
        return 0;
      },
      kill: () => {},
    };
    // A waiter that queued after this run: it waits behind it.
    const f = fake({ files: { [`${PATH}.wait.30`]: queued(30, "userhome", 9000) }, child });
    f.env.after = (ms, fn) => {
      const timer = { ms, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    };
    expect(await run(f.env, ["bun", "run", "e2e"])).toBe(0);
    expect(timers.map((t) => [t.ms, t.cancelled])).toEqual([[LONG_HOLD_MS, true]]);
    expect(f.logs).toEqual([
      "slot: this run has held the slot for over 20m (LONG); 1 waiting for it",
    ]);
  });

  test("--status marks a holder past 20 minutes LONG, and each waiter names the holder it waits on", () => {
    const f = fake({
      files: { [PATH]: held(theirs), [`${PATH}.wait.30`]: queued(30, "userhome", 2000) },
    });
    f.env.now = () => 1000 + 25 * 60_000;
    expect(status(f.env)).toBe(
      [
        "held by kiwi: bun run e2e (pid 20, 25m 0s); LONG: over 20m",
        "waiting 1: userhome: bun run test (pid 30, 24m 59s); waits on kiwi (pid 20)",
      ].join("\n"),
    );
  });

  test("#833 review: a C1 control character in a holder's label, such as CSI, becomes a space in the new lines too", () => {
    const f = fake({
      files: {
        [PATH]: held({ ...theirs, label: "ki\u009b2Jwi" }),
        [`${PATH}.wait.30`]: queued(30, "userhome", 2000),
      },
    });
    f.env.now = () => 1000 + 25 * 60_000;
    const out = status(f.env);
    expect(/[\u0080-\u009f]/.test(out)).toBe(false);
    expect(out).toContain("waits on ki 2Jwi (pid 20)");
  });

  test("a waiter is told once when the holder passes 20 minutes, first in line or behind another", async () => {
    for (const ahead of [false, true]) {
      const files: Record<string, string> = { [PATH]: held(theirs) };
      if (ahead) files[`${PATH}.wait.5`] = queued(5, "top-bar", 1000);
      const f = fake({ files });
      let time = 1000 + 19 * 60_000;
      f.env.now = () => time;
      f.env.sleep = async () => {
        time += 60_000;
      };
      let stop = 0;
      expect(await acquire(f.env, "x", () => stop++ >= 5)).toBe(false);
      const long = "slot warning: kiwi (pid 20) has held the slot for over 20m (LONG); waiting";
      expect(f.logs.filter((line) => line === long)).toHaveLength(1);
      expect(f.logs.filter((line) => line.includes("LONG"))).toHaveLength(1);
    }
  });
});
