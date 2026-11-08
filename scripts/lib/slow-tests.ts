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
  return raw.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity] ?? whole;
  });
}

/** A file name as the allowlist keys it: with `/`, whatever the runner's system writes. */
function slashed(path: string): string {
  return path.replaceAll("\\", "/");
}

/** A tag's time in seconds; NaN when the report gives none, so the verdict never reads it as 0. */
function seconds(attrs: string): number {
  const raw = attribute(attrs, "time");
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

/** Each file's and each test's time from a bun JUnit report; tests named `file > describes > test`. */
export function parseJunit(xml: string): JunitTimes {
  const times: JunitTimes = { files: [], tests: [] };
  // The open suites, outermost first: the file's, then one per describe.
  const suites: string[] = [];
  for (const [, close, tag, attrs = "", selfClosing] of xml.matchAll(TAG)) {
    if (tag === "testsuite" && close) suites.pop();
    else if (tag === "testsuite" && !selfClosing) {
      const name =
        suites.length === 0 ? slashed(attribute(attrs, "name")) : attribute(attrs, "name");
      if (suites.length === 0) {
        times.files.push({ file: name, seconds: seconds(attrs) });
      }
      suites.push(name);
    } else if (tag === "testcase" && !close) {
      const id = [...suites, attribute(attrs, "name")].join(" > ");
      times.tests.push({ id, seconds: seconds(attrs) });
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
    if (!Number.isFinite(seconds))
      verdict.problems.push(`${file}: the report gives no time for the file`);
    else if (seconds > FILE_LIMIT_S) {
      const over = `the file took ${seconds.toFixed(1)} s, over the ${FILE_LIMIT_S} s limit`;
      judge(file, seconds, allow.files[file], over);
    }
  }
  for (const { id, seconds } of times.tests) {
    if (!Number.isFinite(seconds)) verdict.problems.push(`${id}: the report gives no time`);
    else if (seconds > TEST_LIMIT_S) {
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

/** #1022 review: what a missing report means, from the outcome of the test step that writes it. */
export function missingReport(
  outcome: string | undefined,
  path: string,
): { code: number; line: string } {
  return outcome === "success"
    ? { code: 1, line: `slow-tests: the test step passed but left no JUnit report at ${path}` }
    : {
        code: 0,
        line: `slow-tests: no JUnit report at ${path}; the test step did not pass, and says why`,
      };
}

/** The entries no longer needed: under their limit now, or gone from a file that ran. */
function staleEntries(times: JunitTimes, allow: SlowAllowlist): string[] {
  const stale: string[] = [];
  const files = new Map(times.files.map((f) => [f.file, f.seconds]));
  const tests = new Map(times.tests.map((t) => [t.id, t.seconds]));
  for (const file of Object.keys(allow.files)) {
    const took = files.get(file);
    if (took !== undefined && took <= FILE_LIMIT_S) {
      stale.push(`${file}: ${took.toFixed(1)} s now, under the ${FILE_LIMIT_S} s limit`);
    }
  }
  for (const id of Object.keys(allow.tests)) {
    const took = tests.get(id);
    // A PR's run holds only some files: an entry says nothing when its file did not run.
    if (took !== undefined && took <= TEST_LIMIT_S) {
      stale.push(`${id}: ${took.toFixed(1)} s now, under the ${TEST_LIMIT_S} s limit`);
    } else if (took === undefined && files.has(id.split(" > ")[0] ?? "")) {
      stale.push(`${id}: its file ran without it`);
    }
  }
  return stale.map((line) => `slow-tests: stale allowlist entry ${line}`);
}

/**
 * #1022 review: the check's output and exit code. Stale entries are warned about, never failed;
 * a failure lists the slowest tests of the run and names runner noise near a limit.
 * Tests with the same title in one describe share an id, so one entry covers them all.
 */
export function slowReport(
  times: JunitTimes,
  allow: SlowAllowlist,
): { code: number; lines: string[] } {
  const { problems, allowed } = slowVerdict(times, allow);
  const lines = [
    ...allowed.map((line) => `slow-tests: allowed ${line}`),
    ...staleEntries(times, allow),
  ];
  if (problems.length === 0) {
    lines.push(
      `slow-tests: ${times.tests.length} test(s) in ${times.files.length} file(s), none too slow`,
    );
    return { code: 0, lines };
  }
  const slowest = [...times.tests]
    .filter((t) => Number.isFinite(t.seconds))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);
  lines.push(
    `slow-tests: ${problems.length} too slow (#1003):`,
    ...problems.map((problem) => `  - ${problem}`),
    "The slowest tests of this run:",
    ...slowest.map((t) => `  ${t.seconds.toFixed(1)} s  ${t.id}`),
    "Make it faster, or delete it when a faster test checks the same thing (docs/TDD.md). A test fd-qa is still cutting goes in slow-tests-allowlist.json, with its issue. Within 10% of a limit it may be runner noise: rerun the job once before cutting it.",
  );
  return { code: 1, lines };
}

/** #1022 review: the allowlist from its file's text, or the named reason it is unusable. */
export function readAllowlist(text: string): SlowAllowlist | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "slow-tests: slow-tests-allowlist.json is not valid JSON";
  }
  const { tests, files } = (parsed ?? {}) as Partial<SlowAllowlist>;
  const isMap = (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isMap(tests) || !isMap(files)) {
    return "slow-tests: slow-tests-allowlist.json needs a tests and a files map";
  }
  return { tests, files } as SlowAllowlist;
}
