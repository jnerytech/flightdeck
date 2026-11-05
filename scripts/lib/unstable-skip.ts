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

/** The unstable skips of a source, in order. */
export function unstableSkips(_source: string): UnstableSkip[] {
  return [];
}
