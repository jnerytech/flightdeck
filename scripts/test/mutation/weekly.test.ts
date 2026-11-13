import { describe, expect, test } from "bun:test";
import type { MutationDomain, MutationReport } from "../../lib/mutation/report.ts";
import { configPathFor, runWeekly } from "../../lib/mutation/weekly.ts";

const domain = (name: string): MutationDomain => ({
  name,
  mutate: [`src/${name}.ts`],
  tests: [`test/${name}.test.ts`],
});

const reportOf = (...statuses: string[]): MutationReport => ({
  files: {
    "src/x.ts": {
      mutants: statuses.map((status, i) => ({
        id: String(i),
        mutatorName: "ConditionalExpression",
        status,
        location: { start: { line: i + 1, column: 1 } },
      })),
    },
  },
});

describe("weekly mutation run: one Stryker run per domain (#1607)", () => {
  const setup = (over: {
    exit?: Record<string, number>;
    reports?: Record<string, MutationReport | null>;
  }) => {
    const written: Record<string, string> = {};
    const ran: string[] = [];
    const deps = {
      domains: [domain("a"), domain("b")],
      base: { testRunner: "command" },
      writeConfig: (path: string, text: string) => {
        written[path] = text;
      },
      runStryker: (config: string) => {
        ran.push(config);
        return over.exit?.[config] ?? 0;
      },
      readReport: (d: MutationDomain) =>
        over.reports && d.name in over.reports
          ? (over.reports[d.name] ?? null)
          : reportOf("Killed", "Survived"),
    };
    return { deps, written, ran };
  };

  test("writes each domain's config, runs Stryker on it in order and scores its report", () => {
    const { deps, written, ran } = setup({});
    const outcome = runWeekly(deps);
    expect(ran).toEqual([configPathFor(domain("a")), configPathFor(domain("b"))]);
    expect(JSON.parse(written[configPathFor(domain("a"))] ?? "{}").mutate).toEqual(["src/a.ts"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.results.map((r) => [r.domain, r.score, r.survivors.length])).toEqual([
      ["a", 50, 1],
      ["b", 50, 1],
    ]);
  });

  test("a domain whose Stryker run exits non-zero has no score, and the next domain still runs", () => {
    const { deps, ran } = setup({ exit: { [configPathFor(domain("a"))]: 1 } });
    const outcome = runWeekly(deps);
    expect(outcome.failed).toEqual(["a"]);
    expect(outcome.results.map((r) => r.domain)).toEqual(["b"]);
    expect(ran).toHaveLength(2);
  });

  test("a run that exits zero but leaves no report counts as failed, not as a score of zero", () => {
    const { deps } = setup({ reports: { b: null } });
    const outcome = runWeekly(deps);
    expect(outcome.failed).toEqual(["b"]);
    expect(outcome.results.map((r) => r.domain)).toEqual(["a"]);
  });

  test("the config of a domain lives in that domain's report folder", () => {
    expect(configPathFor(domain("permissions-risk"))).toBe(
      "reports/mutation/permissions-risk/stryker.config.json",
    );
  });
});
