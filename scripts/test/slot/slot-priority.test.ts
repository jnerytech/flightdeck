import { describe, expect, test } from "bun:test";
import {
  acquire,
  DEFAULT_MAX_AGE_MS,
  estimatedSeconds,
  LONG_HOLD_MS,
  lowerOthers,
  type ProcessInfo,
  parseArgs,
  RENICE_MS,
  run,
  type SlotChild,
  type SlotHolder,
  status,
  testFileCount,
  timingsFrom,
} from "../../lib/slot/index.ts";

import { fake, held, PATH, queued, theirs } from "./slot-setup.ts";

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
  /** Each file's CI seconds (#1541); a file with no timing counts at the table's mean. */
  const timed = (n: number, seconds: number) =>
    Object.fromEntries(testFiles(n).map((f) => [f.replace(/^\.\//, ""), seconds]));
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
    expect(records).toEqual([["slot-files", "block", { detail: "sonar: 61 test files" }]]);
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
    expect(records).toEqual([["slot-files", "block", { detail: "sonar: 61 test files" }]]);
    const given = fake({ files: { [PATH]: held(theirs) }, holder: 20 });
    const waived = recorder(given);
    given.env.heavyReason = "the release gate needs every daemon test";
    expect(await run(given.env, related(61))).toBe(0);
    expect(given.spawned).toHaveLength(1);
    expect(waived.map(([rule, decision]) => [rule, decision])).toEqual([["slot-files", "waived"]]);
  });

  test("#1541: with CI timings, the limit is 60 s of estimated CI time, not 60 files", async () => {
    const quick = fake();
    const quickRecords = recorder(quick);
    quick.env.timings = timed(100, 0.1);
    const slow = fake();
    const slowRecords = recorder(slow);
    slow.env.timings = timed(40, 2);
    const codes = [await run(quick.env, related(100)), await run(slow.env, related(40))];
    expect([codes, quick.spawned.length, quickRecords, slow.spawned, slowRecords]).toEqual([
      [0, 2],
      1,
      [],
      [],
      [["slot-files", "block", { detail: "sonar: 40 test files, about 80 s of CI time" }]],
    ]);
    expect(slow.logs.join("\n")).toContain("40 test files, about 80 s of CI time");
    // Files with no timing count at the mean: 61 untimed files of a 1 s table are about 61 s.
    const untimed = fake();
    const untimedRecords = recorder(untimed);
    untimed.env.timings = { "other/a.test.ts": 1 };
    expect([await run(untimed.env, related(61)), untimedRecords]).toEqual([
      2,
      [["slot-files", "block", { detail: "sonar: 61 test files, about 61 s of CI time" }]],
    ]);
  });

  test("from the OpenCode review: a Windows-style or absolute path finds its own timing", () => {
    const timings = { "apps/daemon/test/slow.test.ts": 50, "apps/daemon/test/x.test.ts": 0.1 };
    const command = (arg: string) => ["bun", "test", arg];
    expect([
      estimatedSeconds(command(".\\apps\\daemon\\test\\slow.test.ts"), timings, "/repo"),
      estimatedSeconds(command("/repo/apps/daemon/test/slow.test.ts"), timings, "/repo"),
      estimatedSeconds(command("./apps/daemon/test/slow.test.ts"), timings, "/repo"),
    ]).toEqual([50, 50, 50]);
  });

  test("from the OpenCode review: over 180 files a reason is needed whatever the timings say", async () => {
    const many = fake();
    const records = recorder(many);
    many.env.timings = timed(181, 0.01);
    expect([await run(many.env, related(181)), records]).toEqual([
      2,
      [["slot-files", "block", { detail: "sonar: 181 test files, about 2 s of CI time" }]],
    ]);
  });

  test("from the OpenCode review: a timings table keeps only finite, non-negative numbers; anything else is no table", () => {
    expect([
      timingsFrom('{"a.test.ts": 1.5, "b.test.ts": "x", "c.test.ts": -1, "d.test.ts": null}'),
      timingsFrom("[1, 2]"),
      timingsFrom("not json"),
      timingsFrom(null),
    ]).toEqual([{ "a.test.ts": 1.5 }, undefined, undefined, undefined]);
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
