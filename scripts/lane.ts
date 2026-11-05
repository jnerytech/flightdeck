#!/usr/bin/env bun
/**
 * `bun run scripts/lane.ts <command...>`: runs the command in the light lane, at most two at a time
 * on the machine and one when less than 5 GB is available (FLIGHTDECK_LANE_PLACES overrides), so
 * typechecks and lints never pile up and run it out of memory. `bun run typecheck`
 * and `bun run lint` go through it. The logic is in `lib/lane.ts`; this file is the real files,
 * clock and processes (the lock files sit next to the slot's, in the temp folder).
 */
import { linkSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { lanePlaces, runInLane } from "./lib/lane.ts";
import type { SlotEnv } from "./lib/slot.ts";

/** The file is written whole under another name and linked in, as the slot does. */
function create(path: string, data: string): boolean {
  const staging = `${path}.${process.pid}`;
  writeFileSync(staging, data);
  try {
    linkSync(staging, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(staging);
  }
}

const lock = (place: number) =>
  ({
    fs: {
      create,
      read: (path: string) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return null;
        }
      },
      remove: (path: string) => rmSync(path, { force: true }),
      list: () => [],
    },
    path: join(tmpdir(), `flightdeck-lane-light-${place}.lock`),
    pid: process.pid,
    label: process.env.FLIGHTDECK_SLOT_LABEL || basename(process.cwd()),
    alive: (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    now: () => Date.now(),
    // tryAcquire and release read only these fields of a SlotEnv.
  }) as unknown as SlotEnv;

const args = process.argv.slice(2);
const command = args[0] === "--" ? args.slice(1) : args;
const [program = "bun", ...rest] = command;
/** The memory left now: /proc/meminfo on Linux, null elsewhere (the lane keeps 2 places). */
function meminfo(): string | null {
  try {
    return readFileSync("/proc/meminfo", "utf8");
  } catch {
    return null;
  }
}

const places = () => lanePlaces(meminfo(), process.env.FLIGHTDECK_LANE_PLACES);
const capacity = Math.max(2, places());
process.exit(
  await runInLane(command, {
    locks: Array.from({ length: capacity }, (_, place) => lock(place)),
    places,
    nested: Boolean(process.env.FLIGHTDECK_LANE_HOLDER || process.env.FLIGHTDECK_SLOT_HOLDER),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.error(line),
    spawn: () => {
      const child = Bun.spawn([program === "bun" ? process.execPath : program, ...rest], {
        stdio: ["inherit", "inherit", "inherit"],
        env: { ...process.env, FLIGHTDECK_LANE_HOLDER: String(process.pid) },
      });
      return { wait: () => child.exited, kill: () => child.kill() };
    },
  }),
);
