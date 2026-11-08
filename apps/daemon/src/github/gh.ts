/**
 * Phase 37: the host's `gh`, looked up on the PATH of the moment (the tests put a fake there). The
 * daemon never holds a GitHub token: `gh` keeps it, and everything here reads `gh`'s own answers.
 */
import { tmpdir } from "node:os";
import { runCommand } from "../board/command.ts";
import { cli } from "../board/pr.ts";
import { FlightdeckError } from "../errors.ts";

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The run was killed at its limit. */
  timedOut?: boolean;
}

/** Runs `gh`; `null` when it is not installed. */
export type GhRunner = (args: string[]) => Promise<GhResult | null>;

/** How long a `gh` run in a given folder may take before it is killed (issue #79). */
export const GH_IN_TIMEOUT_MS = 20_000;

/**
 * Issue #79: the real `gh` run in a given folder, so `{owner}` and `{repo}` come from its remote.
 * One that has not answered by the limit is killed with what it started and the result says `timedOut`.
 */
export const runGhIn = async (
  args: string[],
  cwd: string,
  timeoutMs: number = GH_IN_TIMEOUT_MS,
): Promise<GhResult | null> => {
  try {
    return await cli("gh", args, cwd, undefined, (cmd, dir, input) =>
      runCommand(cmd, dir, input, timeoutMs),
    );
  } catch (error) {
    if (error instanceof FlightdeckError && error.reason === "tool_missing") return null;
    throw error;
  }
};

/** The real `gh`, run from a neutral folder so no repository decides which account it asks about. */
export const runGh: GhRunner = async (args) => {
  try {
    return await cli("gh", args, tmpdir());
  } catch (error) {
    if (error instanceof FlightdeckError && error.reason === "tool_missing") return null;
    throw error;
  }
};
