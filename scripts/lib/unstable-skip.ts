import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A test skipped off Linux because it is unstable (docs/TDD.md): `test.skipIf(notLinux)(…)` with
 * `// unstable: #<issue> <reason>` on the same line or the line above. The fix goes to that issue.
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

/** The note: an issue number and at least one word of reason. */
const NOTE = /\/\/ unstable: #\d+ \S/;

/** A line that is only the note, as the line above a skip. */
const NOTE_LINE = /^\s*\/\/ unstable: #\d+ \S/;

/** The unstable skips of a source, in order. */
export function unstableSkips(source: string): UnstableSkip[] {
  const lines = source.split("\n");
  const skips: UnstableSkip[] = [];
  lines.forEach((text, i) => {
    if (!OFF_LINUX.test(text)) return;
    const documented = NOTE.test(text) || NOTE_LINE.test(lines[i - 1] ?? "");
    skips.push({ line: i + 1, documented });
  });
  return skips;
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
export function unstableSkipCounts(root: string): Record<string, SkipCount> {
  const counts: Record<string, SkipCount> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        const skips = unstableSkips(readFileSync(path, "utf8"));
        if (skips.length === 0) continue;
        counts[relative(root, path).replaceAll("\\", "/")] = {
          total: skips.length,
          undocumented: skips.filter((skip) => !skip.documented).length,
        };
      }
    }
  };
  for (const dir of UNSTABLE_ROOTS) {
    if (existsSync(join(root, dir))) walk(join(root, dir));
  }
  return counts;
}
