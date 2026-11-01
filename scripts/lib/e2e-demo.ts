/** The demo the e2e runner starts: where it says it is ready, and how it is stopped. */
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

export const pidFile = (dir: string) => dir;
export const stateFile = (dir: string) => dir;

export function stopTree(pid: number, deps: StopDeps): void {
  void pid;
  void deps;
}

export interface FileDeps {
  read: (path: string) => string | null;
  remove: (path: string) => void;
}

export function stopDemo(dir: string, files: FileDeps, deps: StopDeps): boolean {
  void dir;
  void files;
  void deps;
  return true;
}

export interface WaitDeps {
  read: (path: string) => string | null;
  alive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export async function waitForState(
  dir: string,
  timeoutMs: number,
  deps: WaitDeps,
): Promise<DemoState> {
  void dir;
  void timeoutMs;
  void deps;
  return { url: "", ids: {} as DemoIds };
}
