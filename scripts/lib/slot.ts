/**
 * The full-gate slot: one exclusive lock for the heavy commands (full suite, e2e, shots, smokes,
 * builds), so two sessions never run them at once. Every effect (files, clock, processes) comes
 * in through `SlotEnv`, so the tests run nothing real and wait for nothing.
 */

/** Who holds the slot, as written in the lock file. */
export interface SlotHolder {
  pid: number;
  label: string;
  command: string;
  startedAt: number;
}

export interface SlotFs {
  /** Creates the file with all its content in one atomic step; false when it already exists. */
  create(path: string, data: string): boolean;
  read(path: string): string | null;
  remove(path: string): void;
}

export interface SlotChild {
  wait(): Promise<number>;
  kill(): void;
}

export interface SlotEnv {
  fs: SlotFs;
  path: string;
  pid: number;
  label: string;
  alive(pid: number): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  spawn(command: string[], nice: boolean): SlotChild;
  /** Calls the handler with the exit code of SIGINT or SIGTERM; returns the way to stop listening. */
  onSignal(handler: (code: number) => void): () => void;
}

export type SlotArgs =
  | { kind: "status" }
  | { kind: "run"; nice: boolean; command: string[] }
  | { kind: "usage" };

export type Attempt = { acquired: boolean; holder: SlotHolder | null };

export const POLL_MS = 2000;
export const USAGE = "usage: bun run slot -- [--nice] <command...> | bun run slot -- --status";

export function parseArgs(argv: string[]): SlotArgs {
  return { kind: "usage" };
}

export function parseHolder(text: string | null): SlotHolder | null {
  return { pid: 0, label: "", command: "", startedAt: 0 };
}

export function describeHolder(holder: SlotHolder, now: number): string {
  return "";
}

export function tryAcquire(env: SlotEnv, command: string): Attempt {
  return { acquired: false, holder: null };
}

export async function acquire(
  env: SlotEnv,
  command: string,
  stopped: () => boolean,
): Promise<boolean> {
  return false;
}

export function release(env: SlotEnv): void {}

export function status(env: SlotEnv): string {
  return "";
}

export async function run(env: SlotEnv, argv: string[]): Promise<number> {
  return -1;
}
