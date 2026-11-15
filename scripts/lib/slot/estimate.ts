/**
 * What a slot run is worth in test files and CI seconds (#833, #1541): which commands are a
 * `bun test`, how many test files one names, and how long the CI timings say they take. Pure: the
 * lock decides what to do with the answer.
 */

/** The most test files a slot run may name without a reason (#833); `test:related` takes the slot above it. */
export const SLOT_TEST_FILES = 60;
/**
 * #1541: with the suite's CI timings known, the limit is this many seconds of estimated CI time:
 * a run over 60 unit files takes seconds, one of 40 slow files may hold the slot for minutes.
 */
export const SLOT_TEST_SECONDS = 60;
/** Past this many files a run needs a reason whatever the timings say (stale or missing ones). */
export const SLOT_TEST_FILES_CAP = 3 * SLOT_TEST_FILES;

const TEST_ARG = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * The CI timings table from its text (#1541): only finite, non-negative numbers; anything that is
 * not an object of them is no table, so the 60-file limit applies.
 */
export function timingsFrom(text: string | null): Record<string, number> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
  );
  return Object.fromEntries(entries);
}

/** How many test files a `bun ... test` command names; 0 for any other command (#833). */
export function testFileCount(command: string[]): number {
  if (!isBunTest(command.join(" "))) return 0;
  return command.filter((arg) => TEST_ARG.test(arg)).length;
}

/** The CI seconds a run's test files take (#1541): a file with no timing counts at their mean. */
export function estimatedSeconds(
  command: string[],
  timings: Record<string, number>,
  root = "",
): number {
  const values = Object.values(timings);
  const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 1;
  // The table's keys are repo-relative with "/": a Windows-style or absolute path is read as one.
  const base = `${root.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  const key = (arg: string) => {
    const path = arg.replaceAll("\\", "/");
    const inside = base !== "/" && path.startsWith(base) ? path.slice(base.length) : path;
    return inside.replace(/^\.\//, "");
  };
  return command
    .filter((arg) => TEST_ARG.test(arg))
    .reduce((sum, arg) => sum + (timings[key(arg)] ?? mean), 0);
}

/** `bun test ...`, `bun --config=x test ...` or a path to bun: its first plain argument is `test`. */
export function isBunTest(command: string): boolean {
  const [program, ...args] = command.trim().split(/\s+/);
  if (
    !program ||
    program
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/, "") !== "bun"
  )
    return false;
  return args.find((arg) => !arg.startsWith("-")) === "test";
}
