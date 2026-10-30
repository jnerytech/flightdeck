/**
 * Phase 17: how a free command (`run_with_secret`) reaches a shell. The command is Claude's own
 * line, so it is the one place where a shell is wanted; the secrets are in the environment, never
 * in the line.
 */

export interface ShellLine {
  argv: string[];
  /** Removes whatever had to be written for the line to run. */
  cleanup(): void;
}

export function shellLine(_command: string, _platform: NodeJS.Platform): ShellLine {
  return { argv: [], cleanup: () => {} };
}
