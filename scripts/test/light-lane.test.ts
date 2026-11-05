import { describe, expect, test } from "bun:test";
import { type LaneDeps, runInLane } from "../lib/lane.ts";
import type { SlotEnv } from "../lib/slot.ts";

const ME = 100;

/** A lane of two places over one in-memory folder; `alive` is the set of live pids. */
function lane(files: Record<string, string>, alive: Set<number>, nested = false) {
  const logs: string[] = [];
  const ran: { command: string; holding: string[] }[] = [];
  let sleeps = 0;
  const onSleep: (() => void)[] = [];
  const fs = {
    create: (path: string, data: string) => {
      if (path in files) return false;
      files[path] = data;
      return true;
    },
    read: (path: string) => files[path] ?? null,
    remove: (path: string) => {
      delete files[path];
    },
    list: () => [],
  };
  const lock = (path: string) =>
    ({
      fs,
      path,
      pid: ME,
      label: "fd-test",
      alive: (pid: number) => alive.has(pid),
      now: () => 5_000,
    }) as unknown as SlotEnv;
  const deps: LaneDeps = {
    locks: [lock("/t/lane-0.lock"), lock("/t/lane-1.lock")],
    nested,
    sleep: async () => {
      sleeps++;
      onSleep.shift()?.();
    },
    log: (line) => logs.push(line),
    spawn: (command) => {
      const holding = Object.entries(files)
        .filter(([, text]) => JSON.parse(text).pid === ME)
        .map(([path]) => path);
      ran.push({ command: command.join(" "), holding });
      return { wait: async () => 3, kill: () => {} };
    },
  };
  return { deps, logs, ran, files, onSleep, sleeps: () => sleeps };
}

const holder = (pid: number, command = "bun run typecheck") =>
  JSON.stringify({ pid, label: `s${pid}`, command, startedAt: 1_000 });

describe("light-lane", () => {
  test("a free lane runs the command in the first place, returns its code and gives the place back", async () => {
    const l = lane({}, new Set([ME]));
    expect(await runInLane(["bun", "run", "typecheck"], l.deps)).toBe(3);
    expect(l.ran).toEqual([{ command: "bun run typecheck", holding: ["/t/lane-0.lock"] }]);
    expect(l.files).toEqual({});
  });

  test("with the first place taken by a live run, the second place is used", async () => {
    const l = lane({ "/t/lane-0.lock": holder(200) }, new Set([ME, 200]));
    await runInLane(["tsc"], l.deps);
    expect(l.ran[0]?.holding).toEqual(["/t/lane-1.lock"]);
    expect(Object.keys(l.files)).toEqual(["/t/lane-0.lock"]);
  });

  test("with both places taken it waits, names the holders once, and runs when a place frees", async () => {
    const files = { "/t/lane-0.lock": holder(200), "/t/lane-1.lock": holder(201, "biome check .") };
    const alive = new Set([ME, 200, 201]);
    const l = lane(files, alive);
    l.onSleep.push(
      () => {},
      () => alive.delete(201),
    );
    expect(await runInLane(["tsc"], l.deps)).toBe(3);
    expect(l.sleeps()).toBe(2);
    expect(l.logs.filter((line) => line.includes("light lane busy")).length).toBe(1);
    expect(l.logs.join("\n")).toContain("s200: bun run typecheck");
    expect(l.logs.join("\n")).toContain("s201: biome check .");
    expect(l.ran[0]?.holding).toEqual(["/t/lane-1.lock"]);
  });

  test("a lock left by a dead run is taken over", async () => {
    const l = lane({ "/t/lane-0.lock": holder(999) }, new Set([ME]));
    await runInLane(["tsc"], l.deps);
    expect(l.ran[0]?.holding).toEqual(["/t/lane-0.lock"]);
  });

  test("a nested call runs at once and touches no lock", async () => {
    const l = lane(
      { "/t/lane-0.lock": holder(200), "/t/lane-1.lock": holder(201) },
      new Set([ME, 200, 201]),
      true,
    );
    expect(await runInLane(["tsc"], l.deps)).toBe(3);
    expect(l.sleeps()).toBe(0);
    expect(l.ran[0]?.holding).toEqual([]);
  });

  test("a lock that cannot be used runs the command anyway and says so", async () => {
    const l = lane({}, new Set([ME]));
    for (const lock of l.deps.locks) {
      lock.fs.create = () => {
        throw new Error("EACCES");
      };
    }
    expect(await runInLane(["tsc"], l.deps)).toBe(3);
    expect(l.logs.join("\n")).toContain("running without it");
    expect(l.ran.length).toBe(1);
  });
});
