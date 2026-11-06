// The slot's orphans and self-deadlocks (#236), ported from the 2026-11-05 branch onto the
// first-come queue of #372.
import { describe, expect, test } from "bun:test";
import {
  describeHolder,
  type ProcReader,
  parseArgs,
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
      "waiting 1: sessproj: bun run test (pid 30, 4s) in /repos/flightdeck-sessproj",
      "waiting 2: glyphs: bun run demo:shots (pid 31, 4s) in ? ORPHAN",
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
