/** The demo the e2e runner starts: where it says it is ready, and how it is stopped. */
import { join } from "node:path";
import type { DemoIds } from "../demo-seed.ts";

export interface DemoState {
  url: string;
  ids: DemoIds;
}

export interface StopDeps {
  platform: string;
  /** `process.kill`. */
  kill: (pid: number, signal: string) => void;
  /** Runs a command to completion (`taskkill` on Windows). */
  run: (command: string[]) => void;
}

export const pidFile = (dir: string) => join(dir, "demo.pid");
export const stateFile = (dir: string) => join(dir, "demo-state.json");

/**
 * Stops the demo and everything under it (Vite and the fake hosts). The demo is started as the
 * leader of its own process group, so on Linux and macOS a signal to the group reaches them all;
 * on Windows `taskkill /T` walks the tree.
 */
export function stopTree(pid: number, deps: StopDeps): void {
  if (deps.platform === "win32") {
    deps.run(["taskkill", "/PID", String(pid), "/T", "/F"]);
    return;
  }
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      deps.kill(-pid, signal);
    } catch {
      // The group is already gone.
    }
  }
}

export interface FileDeps {
  read: (path: string) => string | null;
  remove: (path: string) => void;
}

/**
 * The teardown: kills the pid the setup recorded right after the spawn (so it works when the
 * setup failed before the demo was ready) and removes the files. False when nothing was started.
 */
export function stopDemo(dir: string, files: FileDeps, deps: StopDeps): boolean {
  const pid = Number.parseInt(files.read(pidFile(dir)) ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  stopTree(pid, deps);
  files.remove(pidFile(dir));
  files.remove(stateFile(dir));
  return true;
}

export interface WaitDeps {
  read: (path: string) => string | null;
  alive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Waits for the demo to write its state file, which it does once Vite is up. */
export async function waitForState(
  dir: string,
  timeoutMs: number,
  deps: WaitDeps,
): Promise<DemoState> {
  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    if (!deps.alive()) throw new Error("o demo parou antes de ficar pronto");
    const text = deps.read(stateFile(dir));
    if (text) {
      try {
        return JSON.parse(text) as DemoState;
      } catch {
        // Half written: read it again.
      }
    }
    await deps.sleep(200);
  }
  throw new Error(`o demo não ficou pronto em ${timeoutMs} ms`);
}
