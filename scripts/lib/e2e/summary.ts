/**
 * The e2e journeys of a run (#1854), from the shards' Playwright JSON reports: how many passed,
 * were flaky (failed, then passed on the retry), failed or were skipped, and the slowest journey.
 * The pyramid table of the unit and integration tiers comes from JUnit; the journeys run in their
 * own jobs, so their row is built here from the reports those jobs publish.
 */

interface Journey {
  title: string;
  status: string;
  seconds: number;
}

interface Suite {
  specs?: Array<{
    title?: string;
    tests?: Array<{ status?: string; results?: Array<{ duration?: number }> }>;
  }>;
  suites?: Suite[];
}

function journeysOf(suite: Suite): Journey[] {
  const own = (suite.specs ?? []).flatMap((spec) =>
    (spec.tests ?? []).map((test) => ({
      title: spec.title ?? "",
      status: test.status ?? "",
      seconds: (test.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0) / 1000,
    })),
  );
  return [...own, ...(suite.suites ?? []).flatMap(journeysOf)];
}

function parse(report: string): Journey[] | null {
  try {
    const root = JSON.parse(report) as Suite;
    return journeysOf(root);
  } catch {
    return null;
  }
}

/** The job summary's markdown, or "" when no shard left a readable report. */
export function e2eSummary(reports: string[]): string {
  const read = reports.map(parse).filter((r): r is Journey[] => r !== null);
  if (read.length === 0) return "";
  const all = read.flat();
  const count = (status: string) => all.filter((j) => j.status === status).length;
  const slowest = all.reduce<Journey | null>((a, j) => (!a || j.seconds > a.seconds ? j : a), null);
  return `${[
    "### E2E journeys",
    "",
    "| journeys | passed | flaky | failed | skipped | slowest |",
    "| ---: | ---: | ---: | ---: | ---: | --- |",
    `| ${all.length} | ${count("expected")} | ${count("flaky")} | ${count("unexpected")} | ${count("skipped")} | ${
      slowest ? `${slowest.title} (${slowest.seconds.toFixed(1)} s)` : "–"
    } |`,
  ].join("\n")}\n`;
}
