import { describe, expect, test } from "bun:test";
import { e2eSummary } from "../../lib/e2e/summary.ts";

/** A Playwright JSON report: one spec per entry, its tests' statuses and result durations in ms. */
function report(specs: Array<{ title: string; status: string; ms: number[] }>): string {
  return JSON.stringify({
    suites: [
      {
        title: "journeys.e2e.ts",
        specs: specs.map((s) => ({
          title: s.title,
          tests: [{ status: s.status, results: s.ms.map((duration) => ({ duration })) }],
        })),
        suites: [],
      },
    ],
  });
}

describe("e2e summary of a run (#1854)", () => {
  test("counts the journeys by outcome across the shards, and names the slowest one", () => {
    const md = e2eSummary([
      report([
        { title: "pt-BR board", status: "expected", ms: [4000] },
        { title: "en board", status: "expected", ms: [9000] },
      ]),
      report([
        { title: "en radar", status: "flaky", ms: [1000, 2000] },
        { title: "en gone", status: "unexpected", ms: [500] },
        { title: "en later", status: "skipped", ms: [] },
      ]),
    ]);
    expect(md).toContain("### E2E journeys");
    expect(md).toContain("| 5 | 2 | 1 | 1 | 1 |");
    expect(md).toContain("en board (9.0 s)");
  });

  test("a flaky journey counts its retry time, and nested suites are walked", () => {
    const nested = JSON.stringify({
      suites: [
        {
          title: "a",
          specs: [],
          suites: [
            {
              title: "b",
              specs: [
                {
                  title: "deep",
                  tests: [{ status: "flaky", results: [{ duration: 3000 }, { duration: 4000 }] }],
                },
              ],
              suites: [],
            },
          ],
        },
      ],
    });
    expect(e2eSummary([nested])).toContain("deep (7.0 s)");
  });

  test("no report, or an unreadable one, prints nothing rather than zeros", () => {
    expect(e2eSummary([])).toBe("");
    expect(e2eSummary(["not json"])).toBe("");
  });
});
