/**
 * Issue #3428: the CLI-first parity table (docs/cli-parity.json). Every daemon command of the
 * protocol (`cmd("<name>", ...)`) has a row: the `flightdeckd` command that covers it, an
 * `appOnly` reason, or an empty row (a gap). The gaps are a number that only goes down; a command
 * with no row, a row that names a missing CLI command and an `appOnly` with no reason fail.
 */

type ParityRow = { cli?: string; appOnly?: string };

type ParityResult = { gaps: string[]; problems: string[] };

/** The command names the `cmd("<name>", ...)` entries of some protocol sources declare, sorted. */
export function protocolCommands(sources: readonly string[]): string[] {
  const names = new Set<string>();
  for (const source of sources)
    for (const match of source.matchAll(/\bcmd\(\s*"([\w.]+)"/g)) names.add(match[1] as string);
  return [...names].sort((a, b) => (a < b ? -1 : Number(a > b)));
}

function parseTable(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text); // NOSONAR: a repo file of ours, checked below
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isText = (value: unknown) => value === undefined || typeof value === "string";

function isRow(row: unknown): row is ParityRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const { cli, appOnly } = row as Record<string, unknown>;
  return isText(cli) && isText(appOnly);
}

/** What is wrong with one row, if anything. */
function rowProblem(name: string, row: unknown, cliCommands: ReadonlySet<string>): string | null {
  if (!isRow(row)) return `${name}: a row is one object whose cli and appOnly are strings`;
  if (row.cli !== undefined && row.appOnly !== undefined)
    return `${name}: a row names a CLI command or an app-only reason, not both`;
  if (row.cli !== undefined && !cliCommands.has(row.cli))
    return `${name}: the row names the CLI command "${row.cli}", which flightdeckd does not have`;
  if (row.appOnly?.trim() === "") return `${name}: an app-only row needs its reason`;
  return null;
}

/** The commands the table does not cover yet, and what is wrong with the table itself. */
export function parityCheck(input: {
  commands: readonly string[];
  table: string | null;
  cliCommands: readonly string[];
}): ParityResult {
  const rows = parseTable(input.table);
  if (!rows)
    return {
      gaps: [...input.commands],
      problems: ["docs/cli-parity.json is missing or is not a JSON object of rows"],
    };
  const cli = new Set(input.cliCommands);
  const gaps: string[] = [];
  const problems: string[] = [];
  for (const name of input.commands) {
    const row = rows[name];
    if (!row) {
      problems.push(`${name}: no row in docs/cli-parity.json`);
      continue;
    }
    const problem = rowProblem(name, row, cli);
    if (problem) problems.push(problem);
    else if (Object.keys(row).length === 0) gaps.push(name);
  }
  return { gaps, problems };
}

/**
 * The commands that are a gap now (`headGaps`) and were not one in the table at the merge base with main:
 * a new command with an empty row, or a covered row emptied. There is no baseline file to rewrite: two PRs
 * that each close a gap, or add a row, no longer conflict (#3759). With no readable table at the base,
 * nothing is compared, as the other ratchets that read the merge base do.
 */
export function newGaps(baseTable: string | null, headGaps: readonly string[]): string[] {
  const rows = parseTable(baseTable);
  if (!rows) return [];
  const before = new Set(
    Object.entries(rows).flatMap(([name, row]) =>
      row && typeof row === "object" && Object.keys(row).length === 0 ? [name] : [],
    ),
  );
  return headGaps.filter((name) => !before.has(name));
}
