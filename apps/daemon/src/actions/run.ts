/** Stub. */
import type { ActionDef } from "./schema.ts";

export interface SshJob {
  target: string;
  argv: string[];
  env: Record<string, string>;
  timeoutS: number;
}

export type SshExecutor = (
  job: SshJob,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface RunOptions {
  /** The folder relative paths are resolved against (the project's). */
  base: string;
  /** The daemon's environment; what reaches the program is cleaned. */
  baseEnv?: Record<string, string | undefined>;
  /** Milliseconds; the action's `timeoutS` when absent (tests make it short). */
  timeoutMs?: number;
  ssh?: SshExecutor;
}

export interface RunResult {
  exitCode: number;
  output: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

/** Stub. */
export function resolveParams(
  _action: ActionDef,
  _given: Record<string, string>,
): Record<string, string> {
  return {};
}

/** Stub. */
export async function runAction(
  _action: ActionDef,
  _params: Record<string, string>,
  _secrets: Record<string, string>,
  _opts: RunOptions,
): Promise<RunResult> {
  return { exitCode: 0, output: "", durationMs: 0, timedOut: false, truncated: false };
}
