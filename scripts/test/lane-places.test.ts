import { describe, expect, test } from "bun:test";
import { lanePlaces, runInLane } from "../lib/lane.ts";
import type { SlotEnv } from "../lib/slot.ts";

const meminfo = (kb: number) =>
  `MemTotal:       16334848 kB\nMemFree:          400000 kB\nMemAvailable:   ${kb} kB\n`;
const GB = 1024 * 1024;

describe("lane-places", () => {
  test("one place per 2.5 GB available, never fewer than 1 nor more than 2", () => {
    expect(lanePlaces(meminfo(1.5 * GB), undefined)).toBe(1);
    expect(lanePlaces(meminfo(4.9 * GB), undefined)).toBe(1);
    expect(lanePlaces(meminfo(5 * GB), undefined)).toBe(2);
    expect(lanePlaces(meminfo(12 * GB), undefined)).toBe(2);
  });

  test("off Linux, or with no MemAvailable line, the lane keeps its 2 places", () => {
    expect(lanePlaces(null, undefined)).toBe(2);
    expect(lanePlaces("MemTotal: 1 kB\n", undefined)).toBe(2);
  });

  test("FLIGHTDECK_LANE_PLACES wins when it is a whole number of at least 1", () => {
    expect(lanePlaces(meminfo(12 * GB), "1")).toBe(1);
    expect(lanePlaces(meminfo(1 * GB), "3")).toBe(3);
    expect(lanePlaces(meminfo(1 * GB), "0")).toBe(1);
    expect(lanePlaces(meminfo(12 * GB), "many")).toBe(2);
  });

  test("with one place open, a run waits even when the second lock is free, and takes it once two open", async () => {
    const files: Record<string, string> = {
      "/t/lane-0.lock": JSON.stringify({ pid: 200, label: "s200", command: "tsc", startedAt: 1 }),
    };
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
      ({ fs, path, pid: 100, label: "me", alive: () => true, now: () => 5 }) as unknown as SlotEnv;
    let open = 1;
    let sleeps = 0;
    const held: string[] = [];
    const code = await runInLane(["tsc"], {
      locks: [lock("/t/lane-0.lock"), lock("/t/lane-1.lock")],
      nested: false,
      places: () => open,
      sleep: async () => {
        sleeps++;
        open = 2;
      },
      log: () => {},
      spawn: () => {
        held.push(...Object.keys(files).filter((p) => JSON.parse(files[p] ?? "{}").pid === 100));
        return { wait: async () => 0, kill: () => {} };
      },
    });
    expect(code).toBe(0);
    expect(sleeps).toBe(1);
    expect(held).toEqual(["/t/lane-1.lock"]);
  });
});
