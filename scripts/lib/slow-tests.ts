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

const TAG = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>/g;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** An attribute of a tag's text, with its XML entities read. */
function attribute(attrs: string, name: string): string {
  const raw = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";
  return raw.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ENTITIES[entity] ?? "");
}

/** Each file's and each test's time from a bun JUnit report; tests named `file > describes > test`. */
export function parseJunit(xml: string): JunitTimes {
  const times: JunitTimes = { files: [], tests: [] };
  // The open suites, outermost first: the file's, then one per describe.
  const suites: string[] = [];
  for (const [, close, tag, attrs = "", selfClosing] of xml.matchAll(TAG)) {
    if (tag === "testsuite" && close) suites.pop();
    else if (tag === "testsuite" && !selfClosing) {
      const name = attribute(attrs, "name");
      if (suites.length === 0) {
        times.files.push({ file: name, seconds: Number(attribute(attrs, "time")) });
      }
      suites.push(name);
    } else if (tag === "testcase" && !close) {
      const id = [...suites, attribute(attrs, "name")].join(" > ");
      times.tests.push({ id, seconds: Number(attribute(attrs, "time")) });
    }
  }
  return times;
}

/** The tests and files over their limit: the ones the allowlist names, and the ones that fail. */
export function slowVerdict(
  times: JunitTimes,
  allow: SlowAllowlist,
): { problems: string[]; allowed: string[] } {
  const verdict = { problems: [] as string[], allowed: [] as string[] };
  const judge = (id: string, seconds: number, why: string | undefined, over: string) => {
    if (why === undefined) verdict.problems.push(`${id}: ${over}`);
    else verdict.allowed.push(`${id}: ${seconds.toFixed(1)} s (${why})`);
  };
  for (const { file, seconds } of times.files) {
    if (seconds > FILE_LIMIT_S) {
      const over = `the file took ${seconds.toFixed(1)} s, over the ${FILE_LIMIT_S} s limit`;
      judge(file, seconds, allow.files[file], over);
    }
  }
  for (const { id, seconds } of times.tests) {
    if (seconds > TEST_LIMIT_S) {
      judge(
        id,
        seconds,
        allow.tests[id],
        `${seconds.toFixed(1)} s, over the ${TEST_LIMIT_S} s limit`,
      );
    }
  }
  return verdict;
}
