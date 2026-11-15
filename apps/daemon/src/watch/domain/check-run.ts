/**
 * Issue #1361: the project's checks, run once for the watch and the check loop: in order, up to
 * the first that does not pass. What a check printed is masked whole, before anyone cuts it, so a
 * secret across a later cut is still caught (docs/decisions/2026-11-09-check-loop.md).
 */
import { SecretScanner } from "../../snippets/index.ts";
import { type BoundedCheckRunner, MAX_VALUE } from "../../workflows/index.ts";
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

/**
 * Why the first local check did not pass (refused, timed out, too large, failed), or null when
 * all passed. A refused command is not the round's to fix (#1361): it says so with `refused`.
 */
export function checkFailure(
  outcome: CheckOutcome,
  timeoutMin: number,
): { text: string; refused: boolean } | null {
  switch (outcome.kind) {
    case "passed":
      return null;
    case "refused":
      return {
        text: `local check refused (${outcome.refusal}): ${outcome.command}`,
        refused: true,
      };
    case "aborted":
      return { text: `local check stopped: ${outcome.command}`, refused: false };
    default:
      if (outcome.timedOut) {
        const text = `local check timed out: ${outcome.command} (after ${timeoutMin} min)`;
        return { text, refused: false };
      }
      if (outcome.tooLarge) {
        return {
          text: `local check stopped: ${outcome.command} printed more than 4 MB`,
          refused: false,
        };
      }
      // Masked whole by runChecks, so the cut below cannot split a secret's line unmasked.
      return {
        text: `local check failed: ${outcome.command} (exit ${outcome.exitCode})\n${outcome.output.slice(-MAX_VALUE)}`,
        refused: false,
      };
  }
}

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
