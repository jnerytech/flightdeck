import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A test skipped because it is unstable (docs/TDD.md): `test.skipIf(notLinux)(…)`, or on any
 * platform `test.skip(…)` / `it.skip(…)` / `describe.skip(…)` (#494), with
 * `// unstable: #<issue> <reason>` on the same line or the line above. The fix goes to that issue,
 * and CI fails once it is closed, so the skip comes out with the fix.
 */
export interface UnstableSkip {
  /** 1-based line of the skipIf. */
  line: number;
  /** Whether it carries a comment with an issue number and a reason. */
  documented: boolean;
}

/** A skip whose condition is "not Linux": `notLinux`, or the platform compared with "linux". */
const OFF_LINUX =
  /\b(?:test|it|describe)\.skipIf\(\s*(?:notLinux|process\.platform\s*!==\s*(?:"linux"|'linux'))\s*\)/;

/** A plain skip, on any platform and any receiver (#494): the same `.skip(` the TDD audit marks. */
const PLAIN = /\.skip\(/;

/** The note: an issue number and at least one word of reason. */
const NOTE = /\/\/ unstable: #(\d+) \S/;

/** A line that is only the note, as the line above a skip. */
const NOTE_LINE = /^\s*\/\/ unstable: #(\d+) \S/;

/** The issue a skip on line `i` (0-based) is noted under: on its line or the line above; null if none. */
export function notedIssue(lines: string[], i: number): number | null {
  const match = NOTE.exec(lines[i] ?? "") ?? NOTE_LINE.exec(lines[i - 1] ?? "");
  return match ? Number(match[1]) : null;
}

/** The unstable skips of a source, in order. */
export function unstableSkips(source: string): UnstableSkip[] {
  const lines = source.split("\n");
  const skips: UnstableSkip[] = [];
  lines.forEach((text, i) => {
    if (!OFF_LINUX.test(text) && !PLAIN.test(text)) return;
    skips.push({ line: i + 1, documented: notedIssue(lines, i) !== null });
  });
  return skips;
}

/** The issue numbers the source's unstable skips are noted under, in order (#494). */
export function skipIssues(source: string): number[] {
  const lines = source.split("\n");
  return unstableSkips(source)
    .map((skip) => notedIssue(lines, skip.line - 1))
    .filter((issue): issue is number => issue !== null);
}

/**
 * Which of the issues are closed, or cannot be read (#494): a skip's issue must be open, so the
 * skip comes out with the fix. `state` gives "open", "closed" or null.
 */
export async function closedSkipIssues(
  issues: number[],
  state: (issue: number) => Promise<string | null>,
): Promise<{ closed: number[]; unknown: number[] }> {
  const result = { closed: [] as number[], unknown: [] as number[] };
  for (const issue of new Set(issues)) {
    const now = await state(issue); // NOSONAR: sequential by design: one gh call at a time
    if (now === null) result.unknown.push(issue);
    else if (now !== "open") result.closed.push(issue);
  }
  return result;
}

/** How many of the source's unstable skips have no complete note. */
export function undocumentedSkips(source: string): number {
  return unstableSkips(source).filter((skip) => !skip.documented).length;
}

/** The test folders the ratchet reads, relative to the repository root. */
export const UNSTABLE_ROOTS: readonly string[] = [
  "apps/daemon/test",
  "apps/desktop/test",
  "packages/protocol/test",
  "scripts/test",
];

/** What the ratchet knows of one test file. */
export interface SkipCount {
  /** Unstable skips in the file. */
  total: number;
  /** Of those, the ones with no complete note. */
  undocumented: number;
}

/** Every test file under the roots that has an unstable skip, keyed under `root`. */
/** Every test file under the roots, with its path relative to `root`. */
function testFilesUnder(root: string): { path: string; rel: string }[] {
  const files: { path: string; rel: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        files.push({ path, rel: relative(root, path).replaceAll("\\", "/") });
      }
    }
  };
  for (const dir of UNSTABLE_ROOTS) {
    if (existsSync(join(root, dir))) walk(join(root, dir));
  }
  return files;
}

export function unstableSkipCounts(root: string): Record<string, SkipCount> {
  const counts: Record<string, SkipCount> = {};
  for (const { path, rel } of testFilesUnder(root)) {
    const skips = unstableSkips(readFileSync(path, "utf8"));
    if (skips.length === 0) continue;
    counts[rel] = {
      total: skips.length,
      undocumented: skips.filter((skip) => !skip.documented).length,
    };
  }
  return counts;
}

/** Every issue the repository's unstable skips are noted under, each once, ascending (#494). */
export function unstableSkipIssues(root: string): number[] {
  const issues = new Set<number>();
  for (const { path } of testFilesUnder(root)) {
    for (const issue of skipIssues(readFileSync(path, "utf8"))) issues.add(issue);
  }
  return [...issues].sort((a, b) => a - b);
}
