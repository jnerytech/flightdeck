import { type CommandResult, FlightdeckError } from "../../kernel/index.ts";

/** Throws with git's own message when a command fails. */
export function must(result: CommandResult, what: string): CommandResult {
  if (result.code !== 0)
    throw new FlightdeckError(
      "invalid_state",
      `${what}: ${result.stderr.trim()}`,
      "command_failed",
      { what, output: result.stderr.trim() },
    );
  return result;
}
