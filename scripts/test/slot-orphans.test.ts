// The slot's orphans and self-deadlocks (#236), ported from the 2026-11-05 branch onto the
// first-come queue of #372.
import { describe, expect, test } from "bun:test";
import {
  describeHolder,
  type ProcReader,
  parseArgs,
  parseStat,
  run,
  type SlotEnv,
  type SlotHolder,
  status,
} from "../lib/slot.ts";

const PATH = "/tmp/flightdeck-slot.lock";
const holder = (pid: number, label: string, command: string): string =>
  JSON.stringify({ pid, label, command, startedAt: 1000 } satisfies SlotHolder);

/** A slot with a fake process table: `parents` maps pid to ppid; `dead` pids are gone. */
function fake(
  files: Record<string, string>,
  parents: Record<number, number>,
  extra: Partial<ProcReader> = {},
) {
  const store = new Map(Object.entries(files));
  const dead = new Set<number>();
  const logs: string[] = [];
  const spawned: string[][] = [];
  const groups: number[] = [];
  const onSleep: (() => void)[] = [];
  let sleeps = 0;
  let time = 5000;
  const proc: ProcReader = {
    ppid: (pid) => (dead.has(pid) ? null : (parents[pid] ?? null)),
    pgid: (pid) => (dead.has(pid) ? null : pid),
    cwd: () => null,
    cmdline: () => ["bun", "run", "/repos/flightdeck/scripts/slot.ts", "bun", "run", "test"],
    group: (pgid) => [pgid],
    ...extra,
  };
  const env: SlotEnv = {
    fs: {
      create: (p, d) => {
        if (store.has(p)) return false;
        store.set(p, d);
        return true;
      },
      read: (p) => store.get(p) ?? null,
      remove: (p) => {
        store.delete(p);
      },
      list: (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
    },
    path: PATH,
    pid: 10,
    label: "me",
    alive: (pid) => !dead.has(pid),
    now: () => time,
    sleep: async (ms) => {
      sleeps++;
      time += ms;
      onSleep.shift()?.();
      // A bounded wait: past five turns the holder is done, so a run that should have given up
      // takes the slot and fails its assertion instead of hanging.
      if (sleeps > 5) store.delete(PATH);
    },
    log: (line) => logs.push(line),
    spawn: (command) => {
      spawned.push(command);
      return { wait: async () => 0, kill: () => {} };
    },
    terminate: () => {},
    onSignal: () => () => {},
    proc,
    terminateGroup: (pgid) => groups.push(pgid),
  };
  return { env, store, dead, logs, spawned, groups, onSleep, sleeps: () => sleeps };
}

describe("slot-orphans", () => {
  test("a run whose ancestor holds the slot runs at once, even without FLIGHTDECK_SLOT_HOLDER", async () => {
    const f = fake(
      { [PATH]: holder(20, "ptree", "bun run test:related") },
      { 10: 15, 15: 20, 20: 1 },
    );
    expect(await run(f.env, ["bun", "test", "a.test.ts"])).toBe(0);
    expect(f.spawned).toEqual([["bun", "test", "a.test.ts"]]);
    expect(f.sleeps()).toBe(0);
    expect(f.store.get(PATH)).toBe(holder(20, "ptree", "bun run test:related"));
  });

  test("a run whose ancestors do not hold the slot waits its turn", async () => {
    const f = fake({ [PATH]: holder(20, "kiwi", "bun run e2e") }, { 10: 15, 15: 1 });
    f.onSleep.push(() => f.store.delete(PATH));
    expect(await run(f.env, ["bun", "run", "test"])).toBe(0);
    expect(f.sleeps()).toBe(1);
  });

  test("a waiter whose shell is already gone (ppid 1) gives up at once and leaves the queue", async () => {
    const f = fake({ [PATH]: holder(20, "kiwi", "bun run e2e") }, { 10: 1 });
    expect(await run(f.env, ["bun", "run", "test"])).toBe(1);
    expect(f.spawned).toEqual([]);
    expect(f.sleeps()).toBe(0);
    expect(f.logs.join("\n")).toContain("the shell that started this run is gone");
    expect([...f.store.keys()]).toEqual([PATH]);
  });

  test("a waiter whose parent dies while it waits gives up, and the queue moves", async () => {
    const f = fake({ [PATH]: holder(20, "kiwi", "bun run e2e") }, { 10: 30, 30: 1 });
    f.onSleep.push(() => f.dead.add(30));
    expect(await run(f.env, ["bun", "run", "test"])).toBe(1);
    expect(f.spawned).toEqual([]);
    expect(f.logs.join("\n")).toContain("the shell that started this run is gone");
    expect([...f.store.keys()]).toEqual([PATH]);
  });

  test("--status lists the waiters with their age, folder and an orphan mark", () => {
    const f = fake(
      {
        [PATH]: holder(20, "kiwi", "bun run e2e"),
        [`${PATH}.wait.30`]: holder(30, "sessproj", "bun run test"),
        [`${PATH}.wait.31`]: holder(31, "glyphs", "bun run demo:shots"),
      },
      { 30: 300, 31: 1 },
      { cwd: (pid) => (pid === 30 ? "/repos/flightdeck-sessproj" : null) },
    );
    expect(status(f.env).split("\n")).toEqual([
      "held by kiwi: bun run e2e (pid 20, 4s)",
      "waiting 1: sessproj: bun run test (pid 30, 4s) in /repos/flightdeck-sessproj; waits on kiwi (pid 20)",
      "waiting 2: glyphs: bun run demo:shots (pid 31, 4s) in ? ORPHAN; waits on kiwi (pid 20)",
    ]);
  });

  test("--reap stops the orphan waiters by process group and removes their files, nothing else", async () => {
    expect(parseArgs(["--reap"])).toEqual({ kind: "reap" });
    const f = fake(
      {
        [PATH]: holder(20, "kiwi", "bun run e2e"),
        [`${PATH}.wait.30`]: holder(30, "sessproj", "bun run test"),
        [`${PATH}.wait.31`]: holder(31, "glyphs", "bun run demo:shots"),
        [`${PATH}.wait.32`]: holder(32, "gone", "bun run smoke"),
      },
      { 20: 1, 30: 300, 31: 1 },
    );
    f.dead.add(32);
    expect(await run(f.env, ["--reap"])).toBe(0);
    expect(f.groups).toEqual([31]);
    expect([...f.store.keys()].sort()).toEqual([PATH, `${PATH}.wait.30`]);
    expect(f.logs.join("\n")).toContain("reaped glyphs: bun run demo:shots (pid 31");
  });

  test("--reap stops only a real slot waiter: the file names its pid, the pid and group are above 1 and not the reaper's group, and its command line is the slot's (#236 review)", async () => {
    const f = fake(
      {
        // The file's name and the pid inside disagree: a forged or copied file.
        [`${PATH}.wait.40`]: holder(31, "forged", "bun run test"),
        // Its group is 0, which kill(-0) would read as the reaper's own group.
        [`${PATH}.wait.41`]: holder(41, "group0", "bun run test"),
        // Its group is the reaper's.
        [`${PATH}.wait.42`]: holder(42, "mygroup", "bun run test"),
        // Not a slot process: a pid reused by a daemon whose parent is pid 1.
        [`${PATH}.wait.43`]: holder(43, "daemon", "bun run test"),
        // A real orphan waiter.
        [`${PATH}.wait.44`]: holder(44, "orphan", "bun run test"),
      },
      { 31: 1, 41: 1, 42: 1, 43: 1, 44: 1 },
      {
        pgid: (pid) => ({ 41: 0, 42: 77, 10: 77 })[pid] ?? pid,
        cmdline: (pid) =>
          pid === 43
            ? ["tmux", "new-session", "-d"]
            : ["bun", "scripts/slot.ts", "bun", "run", "test"],
      },
    );
    expect(await run(f.env, ["--reap"])).toBe(0);
    expect(f.groups).toEqual([44]);
    expect(f.store.has(`${PATH}.wait.44`)).toBe(false);
    for (const n of [40, 41, 42, 43]) expect(f.store.has(`${PATH}.wait.${n}`)).toBe(true);
  });

  test("--reap reads the group once: a waiter that exits after the checks is not killed as group 0, and an editor holding slot.ts is not a waiter (#236 review)", async () => {
    let reads = 0;
    const f = fake(
      {
        [`${PATH}.wait.50`]: holder(50, "racing", "bun run test"),
        [`${PATH}.wait.51`]: holder(51, "editor", "bun run test"),
      },
      { 50: 1, 51: 1 },
      {
        // pid 50 answers its group once, then is gone; the reaper's own group is 10.
        pgid: (pid) => (pid === 50 ? (reads++ === 0 ? 50 : null) : pid),
        cmdline: (pid) =>
          pid === 51
            ? ["vim", "scripts/slot.ts"]
            : ["bun", "run", "scripts/slot.ts", "bun", "test"],
      },
    );
    expect(await run(f.env, ["--reap"])).toBe(0);
    expect(f.groups).toEqual([50]);
  });

  test("--reap leaves a group that holds the slot's holder, or any process that is not an orphan slot waiter (#388 review)", async () => {
    const waiters = {
      [`${PATH}.wait.60`]: holder(60, "with-holder", "bun run test"),
      [`${PATH}.wait.62`]: holder(62, "with-shell", "bun run test"),
      [`${PATH}.wait.64`]: holder(64, "with-nested", "bun run test"),
      [`${PATH}.wait.66`]: holder(66, "pair", "bun run test"),
      [`${PATH}.wait.67`]: holder(67, "pair", "bun run test"),
    };
    const f = fake(
      // The holder, 61, shares group 60 with an orphan waiter.
      { [PATH]: holder(61, "kiwi", "bun run e2e"), ...waiters },
      { 60: 1, 61: 1, 62: 1, 63: 1, 64: 1, 65: 64, 66: 1, 67: 1 },
      {
        pgid: (pid) => ({ 61: 60, 63: 62, 65: 64, 67: 66 })[pid] ?? pid,
        group: (pgid) =>
          ({ 60: [60, 61], 62: [62, 63], 64: [64, 65], 66: [66, 67] })[pgid] ?? [pgid],
        // 63 is a shell in 62's group; 65 is a slot process whose parent is alive (not orphaned).
        cmdline: (pid) =>
          pid === 63
            ? ["bash", "-c", "sleep 600"]
            : ["bun", "run", "scripts/slot.ts", "bun", "test"],
      },
    );
    expect(await run(f.env, ["--reap"])).toBe(0);
    // Only the group made of orphan slot waiters alone goes, once.
    expect(f.groups).toEqual([66]);
    for (const n of [60, 62, 64]) expect(f.store.has(`${PATH}.wait.${n}`)).toBe(true);
  });

  test("--reap knows a slot waiter by its arguments: bun or node running scripts/slot.ts, not a program that names the file (#388 review)", async () => {
    const f = fake(
      {
        [`${PATH}.wait.70`]: holder(70, "less", "bun run test"),
        [`${PATH}.wait.71`]: holder(71, "node", "bun run test"),
      },
      { 70: 1, 71: 1 },
      {
        cmdline: (pid) =>
          pid === 70
            ? ["less", "scripts/slot.ts"]
            : ["/usr/bin/node", "/repo/scripts/slot.ts", "bun", "test"],
      },
    );
    expect(await run(f.env, ["--reap"])).toBe(0);
    expect(f.groups).toEqual([71]);
  });

  test("FLIGHTDECK_SLOT_DETACHED keeps a waiter whose shell is gone in the queue, for a launch that detaches on purpose (#388 review)", async () => {
    const f = fake({ [PATH]: holder(20, "kiwi", "bun run e2e") }, { 10: 1 });
    f.env.detached = true;
    f.onSleep.push(() => f.store.delete(PATH));
    expect(await run(f.env, ["bun", "run", "test"])).toBe(0);
    expect(f.spawned).toEqual([["bun", "run", "test"]]);
    expect(f.sleeps()).toBe(1);
  });

  test("a waiter re-parented while it waits gives up, though its old parent still lives (#388 review)", async () => {
    const parents: Record<number, number> = { 10: 30, 30: 1 };
    const f = fake({ [PATH]: holder(20, "kiwi", "bun run e2e") }, parents);
    f.onSleep.push(() => {
      parents[10] = 1;
    });
    expect(await run(f.env, ["bun", "run", "test"])).toBe(1);
    expect(f.spawned).toEqual([]);
    expect(f.logs.join("\n")).toContain("the shell that started this run is gone");
  });

  test("a /proc stat line reads to its parent and group, whatever the command name holds; anything else reads to null (#388 review)", () => {
    expect(parseStat("123 (bun) S 1 77 77 0 -1")).toEqual({ ppid: 1, pgid: 77 });
    expect(parseStat("123 (a) b (c) S 45 678 678 0 -1")).toEqual({ ppid: 45, pgid: 678 });
    expect(parseStat("123 (x\ny) R 9 9 9")).toEqual({ ppid: 9, pgid: 9 });
    for (const bad of ["", "garbage", "123 (bun) S x y", "123 bun S 1 2"]) {
      expect(parseStat(bad)).toBeNull();
    }
  });

  test("--status keeps each entry to one line: control characters in a label, a command or a folder become spaces (#236 review)", async () => {
    const f = fake(
      {
        [PATH]: holder(20, "kiwi\nwaiting 1: coordinator: cancelled (pid 1, 0s)", "bun run e2e"),
        [`${PATH}.wait.30`]: holder(30, "sessproj", "bun run\u001b[2J test"),
      },
      { 30: 300 },
      { cwd: () => "/repos/evil\nwaiting 9: forged" },
    );
    expect(await run(f.env, ["--status"])).toBe(0);
    expect(f.logs).toEqual([
      "held by kiwi waiting 1: coordinator: cancelled (pid 1, 0s): bun run e2e (pid 20, 4s)",
      "waiting 1: sessproj: bun run [2J test (pid 30, 4s) in /repos/evil waiting 9: forged; waits on kiwi waiting 1: coordinator: cancelled (pid 1, 0s) (pid 20)",
    ]);
  });

  test("a holder's long command (hundreds of test files) is cut, so --status stays one line each", () => {
    const files = Array.from({ length: 300 }, (_, i) => `./apps/daemon/test/area-${i}.test.ts`);
    const line = describeHolder(
      { pid: 20, label: "resume", command: `bun test ${files.join(" ")}`, startedAt: 1000 },
      5000,
    );
    expect(line.length).toBeLessThan(140);
    expect(line).toContain("bun test ./apps/daemon/test/area-0.test.ts");
    expect(line).toContain("…");
    expect(line).toEndWith("(pid 20, 4s)");
  });

  test("--reap takes nothing else; without a group kill it stops the orphan itself; a looping parent table ends", async () => {
    expect(parseArgs(["--reap", "x"])).toEqual({ kind: "usage" });
    expect(parseArgs(["--reap", "--status"])).toEqual({ kind: "usage" });
    const f = fake({ [`${PATH}.wait.31`]: holder(31, "glyphs", "bun run demo:shots") }, { 31: 1 });
    const stopped: number[] = [];
    const env = {
      ...f.env,
      terminateGroup: undefined,
      terminate: (pid: number) => stopped.push(pid),
    };
    expect(await run(env, ["--reap"])).toBe(0);
    expect(stopped).toEqual([31]);
    // A parent table that loops (10 -> 15 -> 16 -> 15 ...) never names the holder: the run waits.
    const loop = fake({ [PATH]: holder(20, "kiwi", "bun run e2e") }, { 10: 15, 15: 16, 16: 15 });
    loop.onSleep.push(() => loop.store.delete(PATH));
    expect(await run(loop.env, ["bun", "run", "test"])).toBe(0);
    expect(loop.sleeps()).toBe(1);
  });
});
