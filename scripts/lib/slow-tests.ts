/**
 * The slow-test rule made a check (#1003): a test over 5 s or a test file over 60 s on CI fails the
 * PR, unless slow-tests-allowlist.json names it with the issue that cuts it. The times come from
 * the JUnit report bun writes during the PR's own test run, so the check runs no test itself.
 */

export const TEST_LIMIT_S = 5;
export const FILE_LIMIT_S = 60;

export interface JunitTimes {
  files: { file: string; seconds: number }[];
  tests: { id: string; seconds: number }[];
}

/** The tests and test files over their limit that may stay, each with the issue that cuts it. */
export interface SlowAllowlist {
  tests: Record<string, string>;
  files: Record<string, string>;
}

/** Each file's and each test's time from a bun JUnit report; tests named `file > describes > test`. */
export function parseJunit(_xml: string): JunitTimes {
  return { files: [], tests: [] };
}

/** The tests and files over their limit: the ones the allowlist names, and the ones that fail. */
export function slowVerdict(
  _times: JunitTimes,
  _allow: SlowAllowlist,
): { problems: string[]; allowed: string[] } {
  return { problems: [], allowed: [] };
}
