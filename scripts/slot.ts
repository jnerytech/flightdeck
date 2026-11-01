#!/usr/bin/env bun
/**
 * `bun run slot -- <command...>`: runs the command once the full-gate slot is free, so the heavy
 * commands (full suite, e2e, shots, smokes, builds) never overlap. `--status` shows the holder,
 * `--nice` lowers the command's priority. The logic is in `lib/slot.ts`; this file is the real
 * files, clock and processes.
 */
import { linkSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { constants, setPriority, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { run, type SlotEnv } from "./lib/slot.ts";

const LOCK = join(tmpdir(), "flightdeck-slot.lock");

/** The file is written whole under another name and linked in, so nobody reads half a lock. */
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

const env: SlotEnv = {
  fs: {
    create,
    read: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    remove: (path) => rmSync(path, { force: true }),
  },
  path: LOCK,
  pid: process.pid,
  label: process.env.FLIGHTDECK_SLOT_LABEL || basename(process.cwd()),
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.error(line),
  spawn: (command, nice) => {
    const child = Bun.spawn(command, { stdio: ["inherit", "inherit", "inherit"] });
    if (nice) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // The command still runs, at normal priority.
      }
    }
    return { wait: () => child.exited, kill: () => child.kill() };
  },
  onSignal: (handler) => {
    const onInt = () => handler(130);
    const onTerm = () => handler(143);
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    return () => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    };
  },
};

process.exit(await run(env, process.argv.slice(2)));
