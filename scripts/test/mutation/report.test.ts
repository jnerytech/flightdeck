import { describe, expect, test } from "bun:test";
import {
  type DomainResult,
  type MutationReport,
  scoreReport,
  strykerConfigFor,
  summaryMarkdown,
  survivorsOf,
} from "../../lib/mutation/report.ts";

const mutant = (
  status: string,
  line = 1,
  mutatorName = "ConditionalExpression",
  replacement = "true",
) => ({
  id: `${status}-${line}`,
  mutatorName,
  replacement,
  status,
  location: { start: { line, column: 1 } },
});

const report = (...mutants: ReturnType<typeof mutant>[]): MutationReport => ({
  files: { "apps/daemon/src/permissions/risk.ts": { mutants } },
});

describe("mutation score: what the weekly run reports per domain (#1607)", () => {
  test("a killed or timed-out mutant is caught, a survivor or uncovered one is not, the rest do not count", () => {
    const counts = scoreReport(
      report(
        mutant("Killed"),
        mutant("Killed"),
        mutant("Timeout"),
        mutant("Survived"),
        mutant("NoCoverage"),
        mutant("CompileError"),
        mutant("Ignored"),
      ),
    );
    expect(counts).toEqual({ killed: 2, timedOut: 1, survived: 1, noCoverage: 1, score: 60 });
  });

  test("the score is a percent with two decimals: the first measurement of risk.ts gives 57.49", () => {
    const mutants = [
      ...Array.from({ length: 374 }, () => mutant("Killed")),
      ...Array.from({ length: 2 }, () => mutant("Timeout")),
      ...Array.from({ length: 278 }, () => mutant("Survived")),
    ];
    expect(scoreReport(report(...mutants)).score).toBe(57.49);
  });

  test("a report with no countable mutant has no score, not zero and not a division error", () => {
    expect(scoreReport(report(mutant("Ignored"), mutant("CompileError"))).score).toBeNull();
    expect(scoreReport({ files: {} }).score).toBeNull();
  });

  test("the counts add up across the files of one domain", () => {
    const both: MutationReport = {
      files: {
        "a.ts": { mutants: [mutant("Killed"), mutant("Survived")] },
        "b.ts": { mutants: [mutant("Killed"), mutant("Killed")] },
      },
    };
    expect(scoreReport(both)).toEqual({
      killed: 3,
      timedOut: 0,
      survived: 1,
      noCoverage: 0,
      score: 75,
    });
  });
});

describe("survivors: the mutants a test should have caught (#1607)", () => {
  test("lists survived and uncovered mutants with file, line, mutator and replacement, in file then line order", () => {
    const both: MutationReport = {
      files: {
        "b.ts": { mutants: [mutant("Survived", 4, "EqualityOperator", "<=")] },
        "a.ts": {
          mutants: [
            mutant("Killed", 1),
            mutant("NoCoverage", 9, "BlockStatement", "{}"),
            mutant("Survived", 2),
          ],
        },
      },
    };
    expect(survivorsOf(both)).toEqual([
      { file: "a.ts", line: 2, mutator: "ConditionalExpression", replacement: "true" },
      { file: "a.ts", line: 9, mutator: "BlockStatement", replacement: "{}" },
      { file: "b.ts", line: 4, mutator: "EqualityOperator", replacement: "<=" },
    ]);
  });

  test("a mutant without a replacement text reads as an empty one", () => {
    const { replacement: _none, ...withoutReplacement } = mutant("Survived");
    const bare = report(withoutReplacement as ReturnType<typeof mutant>);
    expect(survivorsOf(bare)[0]?.replacement).toBe("");
  });
});

describe("one Stryker config per domain (#1607)", () => {
  const base = { testRunner: "command", coverageAnalysis: "off", concurrency: 1 };
  const domain = {
    name: "permissions-risk",
    mutate: ["apps/daemon/src/permissions/risk.ts"],
    tests: ["apps/daemon/test/permissions/risk.test.ts"],
  };

  test("mutates the domain's files and judges them by the domain's tests only", () => {
    const config = strykerConfigFor(domain, base) as {
      mutate: string[];
      commandRunner: { command: string };
    };
    expect(config.mutate).toEqual(domain.mutate);
    expect(config.commandRunner.command).toBe(
      "env -u CLAUDECODE bun --config=bunfig.area.toml test apps/daemon/test/permissions/risk.test.ts",
    );
  });

  test("keeps the base settings and gives the domain its own report, incremental file and temp folder", () => {
    const config = strykerConfigFor(domain, base) as Record<string, unknown> & {
      jsonReporter: { fileName: string };
    };
    expect(config.testRunner).toBe("command");
    expect(config.concurrency).toBe(1);
    expect(config.incremental).toBe(true);
    expect(config.incrementalFile).toBe("reports/mutation/permissions-risk/incremental.json");
    expect(config.jsonReporter.fileName).toBe("reports/mutation/permissions-risk/mutation.json");
    expect(config.tempDirName).toBe(".stryker-tmp/permissions-risk");
  });
});

describe("job summary: the score per domain and the survivors to read (#1607)", () => {
  const result = (domain: string, over: Partial<DomainResult> = {}): DomainResult => ({
    domain,
    killed: 3,
    timedOut: 1,
    survived: 1,
    noCoverage: 0,
    score: 80,
    survivors: [{ file: "a.ts", line: 7, mutator: "EqualityOperator", replacement: "<=" }],
    ...over,
  });

  test("one table row per domain with its score and counts", () => {
    const text = summaryMarkdown([result("permissions-risk")], 10);
    expect(text).toContain("| permissions-risk | 80% | 3 | 1 | 1 | 0 |");
  });

  test("a domain without a score shows a dash", () => {
    expect(summaryMarkdown([result("empty", { score: null })], 10)).toContain("| empty | - |");
  });

  test("lists survivors as file:line, mutator and replacement, and says how many it left out", () => {
    const survivors = Array.from({ length: 3 }, (_, i) => ({
      file: "a.ts",
      line: i + 1,
      mutator: "ConditionalExpression",
      replacement: "true",
    }));
    const text = summaryMarkdown([result("d", { survived: 3, survivors })], 2);
    expect(text).toContain("a.ts:1 ConditionalExpression → `true`");
    expect(text).toContain("a.ts:2 ConditionalExpression → `true`");
    expect(text).not.toContain("a.ts:3 ");
    expect(text).toContain("1 more in the JSON report");
  });
});
