import { describe, expect, test } from "bun:test";
import {
  acquire,
  cancel,
  DEFAULT_MAX_AGE_MS,
  describeHolder,
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
  tryAcquire,
  USAGE,
} from "../lib/slot.ts";

const PATH = "/tmp/flightdeck-slot.lock";
const mine: SlotHolder = { pid: 10, label: "sonar", command: "bun run test", startedAt: 1000 };
const theirs: SlotHolder = { pid: 20, label: "kiwi", command: "bun run e2e", startedAt: 1000 };

/** An in-memory slot: one lock "file", a fake clock that only moves when somebody sleeps. */
function fake(opts: { files?: Record<string, string>; dead?: number[]; child?: SlotChild } = {}) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const logs: string[] = [];
  const sleeps: number[] = [];
  const terminated: number[] = [];
  const spawned: { command: string[]; nice: boolean }[] = [];
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
    spawn: (command, nice) => {
      spawned.push({ command, nice });
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
    expect(status(f.env, 120 * 60_000)).toBe("held by kiwi: bun run e2e (pid 20, 1h 31m)");
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
    expect(f.logs.length).toBe(2);
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

  test("a run without --priority never reads the process list", async () => {
    const f = withProcesses(table());
    expect(await run(f.env, ["bun", "run", "test"])).toBe(0);
    expect(f.listed()).toBe(0);
    expect(f.calls).toEqual([]);
  });
});
