#!/usr/bin/env bun
/**
 * `bun run slot -- <command...>`: runs the command once the full-gate slot is free, so the heavy
 * commands (full suite, e2e, shots, smokes, builds) never overlap. Waiters get the slot in the order
 * they queued. `--status` shows the holder and the waiters with their ages, folders and an ORPHAN
 * mark, `--reap` stops the waiters whose shell is gone (#236),
 * `--nice` lowers the command's priority, `--priority` lowers the other
 * `bun test` processes of the user while the command runs. The logic is in `lib/slot.ts`; this file is the real
 * files, clock and processes.
 */
import {
  linkSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { constants, getPriority, setPriority, tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { type ProcessInfo, type ProcReader, run, type SlotEnv } from "./lib/slot.ts";

const LOCK = process.env.FLIGHTDECK_SLOT_LOCK || join(tmpdir(), "flightdeck-slot.lock");

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

/** The user's processes from `ps`; Windows has none to list, so it renices nothing. */
async function userProcesses(): Promise<ProcessInfo[]> {
  const ps = Bun.spawn(["ps", "-u", String(userInfo().uid), "-o", "pid=,ppid=,ni=,args="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(ps.stdout).text();
  const list: ProcessInfo[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.*)$/.exec(line);
    if (match) {
      list.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        nice: Number(match[3]),
        command: match[4] as string,
      });
    }
  }
  return list;
}

/** The fields of /proc/<pid>/stat after the command name: state, ppid, pgrp, ... (Linux only). */
function statFields(pid: number): string[] | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  } catch {
    return null;
  }
}

/** The process table from /proc; absent off Linux, where ancestry and orphans are not checked. */
const proc: ProcReader | undefined =
  process.platform === "linux"
    ? {
        ppid: (pid) => {
          const fields = statFields(pid);
          return fields ? Number(fields[1]) : null;
        },
        pgid: (pid) => {
          const fields = statFields(pid);
          return fields ? Number(fields[2]) : null;
        },
        cwd: (pid) => {
          try {
            return readlinkSync(`/proc/${pid}/cwd`);
          } catch {
            return null;
          }
        },
      }
    : undefined;

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
    list: (prefix) =>
      readdirSync(tmpdir())
        .map((name) => join(tmpdir(), name))
        .filter((path) => path.startsWith(prefix)),
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
  // The line names the holder's command: one line, whatever the command held, so it cannot forge
  // another log line. NOSONAR: only the queue's own status (label, pid, wait, command) reaches it.
  log: (line) => console.error(line.replace(/[\r\n]+/g, " ")), // NOSONAR
  terminate: (pid) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  },
  holder: Number(process.env.FLIGHTDECK_SLOT_HOLDER) || undefined,
  ...(proc
    ? {
        proc,
        terminateGroup: (pgid: number) => {
          try {
            process.kill(-pgid, "SIGTERM");
          } catch {
            // Gone already, or not ours.
          }
        },
      }
    : {}),
  spawn: (command, nice, asHolder) => {
    // What runs under the lock is told whose it is, so a slot call inside it runs at once.
    const child = Bun.spawn(command, {
      stdio: ["inherit", "inherit", "inherit"],
      // The lock too: a child with another temp folder would otherwise look for another file.
      ...(asHolder
        ? {
            env: {
              ...process.env,
              FLIGHTDECK_SLOT_HOLDER: String(process.pid),
              FLIGHTDECK_SLOT_LOCK: LOCK,
            },
          }
        : {}),
    });
    if (nice) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // The command still runs, at normal priority.
      }
    }
    return { wait: () => child.exited, kill: () => child.kill() };
  },
  ...(process.platform === "win32"
    ? {}
    : {
        processes: userProcesses,
        renice: (pid: number, nice: number) => {
          try {
            // Only up: a process already lower is left as it is.
            if (getPriority(pid) < nice) setPriority(pid, nice);
          } catch {
            // Gone already, or not ours to change.
          }
        },
      }),
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
