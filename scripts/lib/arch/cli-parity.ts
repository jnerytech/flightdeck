/**
 * Issue #3428: the CLI-first parity table (docs/cli-parity.json). Every daemon command of the
 * protocol (`cmd("<name>", ...)`) has a row: the `flightdeckd` command that covers it, an
 * `appOnly` reason, or an empty row (a gap). The gaps are a number that only goes down; a command
 * with no row, a row that names a missing CLI command and an `appOnly` with no reason fail.
 */

export type ParityRow = { cli?: string; appOnly?: string };

export type ParityResult = { gaps: string[]; problems: string[] };

/** The command names the `cmd("<name>", ...)` entries of some protocol sources declare, sorted. */
export function protocolCommands(_sources: readonly string[]): string[] {
  return [];
}

/** The commands the table does not cover yet, and what is wrong with the table itself. */
export function parityCheck(_input: {
  commands: readonly string[];
  table: string | null;
  cliCommands: readonly string[];
}): ParityResult {
  return { gaps: [], problems: [] };
}
