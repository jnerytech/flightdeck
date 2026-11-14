/**
 * Issue #1361: the project's checks, run once for the watch and the check loop: in order, up to
 * the first that does not pass. What a check printed is masked whole, before anyone cuts it, so a
 * secret across a later cut is still caught (docs/decisions/2026-11-09-check-loop.md).
 */
import { SecretScanner } from "../../snippets/index.ts";
import type { BoundedCheckRunner } from "../../workflows/index.ts";
import { type CheckRefusal, checkCommandRefusal } from "./check-command.ts";

const scanner = new SecretScanner();

/** What takes the place of a line that looked like a secret. */
export const REMOVED_LINE = "[line removed: it looked like a secret]";

/** A line that looks like a secret is taken out of what a check printed or a command names. */
export const masked = (text: string): string =>
  text
    .split("\n")
    .map((line) => (scanner.scan(line).length === 0 ? line : REMOVED_LINE))
    .join("\n");

/** How the checks went; a command and an output are always masked. */
export type CheckOutcome =
  | { kind: "passed" }
  | { kind: "refused"; command: string; refusal: CheckRefusal }
  | { kind: "aborted"; command: string }
  | {
      kind: "failed";
      command: string;
      exitCode: number;
      timedOut: boolean;
      tooLarge: boolean;
      output: string;
    };

export async function runChecks(input: {
  checks: readonly string[];
  worktree: string;
  timeoutMin: number;
  /** The project's extra environment names (`checkEnv`). */
  envNames: readonly string[];
  runner: Pick<BoundedCheckRunner, "run">;
  signal?: AbortSignal;
}): Promise<CheckOutcome> {
  for (const command of input.checks) {
    // Stored settings are checked again: only a plain command and its arguments, in the worktree.
    const refusal = checkCommandRefusal(command, input.worktree);
    if (refusal) return { kind: "refused", command: masked(command), refusal };
    const result =
      await /* NOSONAR: checks run one after the other and stop at the first that fails */ input.runner.run(
        command,
        input.worktree,
        input.timeoutMin * 60_000,
        input.signal,
        input.envNames,
      );
    if (result.aborted) return { kind: "aborted", command: masked(command) };
    if (result.timedOut || result.tooLarge || result.exitCode !== 0) {
      return {
        kind: "failed",
        command: masked(command),
        exitCode: result.exitCode,
        timedOut: result.timedOut === true,
        tooLarge: result.tooLarge === true,
        output: masked(result.output),
      };
    }
  }
  return { kind: "passed" };
}
