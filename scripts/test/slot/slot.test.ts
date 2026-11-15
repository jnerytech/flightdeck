import { describe, expect, test } from "bun:test";
import {
  acquire,
  DEFAULT_MAX_AGE_MS,
  describeHolder,
  POLL_MS,
  parseArgs,
  parseHolder,
  release,
  status,
  tryAcquire,
} from "../../lib/slot/index.ts";

import { fake, held, mine, PATH, queued, theirs } from "./slot-setup.ts";

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
