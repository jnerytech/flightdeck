/**
 * Issue #1607: the weekly mutation run. Pure parts: the score of a Stryker JSON report (the
 * mutation-testing-elements shape), the survivors to read, the Stryker config of one domain and
 * the job summary. scripts/mutation-weekly.ts wires the real Stryker and the files.
 */

export interface ReportMutant {
  id: string;
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number; column: number } };
}

export interface MutationReport {
  files: Record<string, { mutants: ReportMutant[] }>;
}

export interface MutationCounts {
  killed: number;
  timedOut: number;
  survived: number;
  noCoverage: number;
  /** Percent with two decimals; null when no mutant counts (all ignored or none made). */
  score: number | null;
}

export interface Survivor {
  file: string;
  line: number;
  mutator: string;
  replacement: string;
}

export interface MutationDomain {
  name: string;
  mutate: string[];
  tests: string[];
}

export interface DomainResult extends MutationCounts {
  domain: string;
  survivors: Survivor[];
}

const MISSED = new Set(["Survived", "NoCoverage"]);

export function scoreReport(report: MutationReport): MutationCounts {
  const counts = { killed: 0, timedOut: 0, survived: 0, noCoverage: 0 };
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === "Killed") counts.killed++;
      else if (mutant.status === "Timeout") counts.timedOut++;
      else if (mutant.status === "Survived") counts.survived++;
      else if (mutant.status === "NoCoverage") counts.noCoverage++;
    }
  }
  const caught = counts.killed + counts.timedOut;
  const total = caught + counts.survived + counts.noCoverage;
  const score = total === 0 ? null : Math.round((caught / total) * 10000) / 100;
  return { ...counts, score };
}

export function survivorsOf(report: MutationReport): Survivor[] {
  const found: Survivor[] = [];
  for (const [file, { mutants }] of Object.entries(report.files)) {
    for (const mutant of mutants) {
      if (!MISSED.has(mutant.status)) continue;
      found.push({
        file,
        line: mutant.location.start.line,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement ?? "",
      });
    }
  }
  return found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

export function strykerConfigFor(
  domain: MutationDomain,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const dir = `reports/mutation/${domain.name}`;
  return {
    ...base,
    mutate: domain.mutate,
    commandRunner: {
      command: `env -u CLAUDECODE bun --config=bunfig.area.toml test ${domain.tests.join(" ")}`,
    },
    incremental: true,
    incrementalFile: `${dir}/incremental.json`,
    jsonReporter: { fileName: `${dir}/mutation.json` },
    tempDirName: `.stryker-tmp/${domain.name}`,
  };
}

export function summaryMarkdown(results: DomainResult[], survivorLimit: number): string {
  const lines = [
    "## Mutation score per domain",
    "",
    "| Domain | Score | Killed | Timed out | Survived | No coverage |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    const score = r.score === null ? "-" : `${r.score}%`;
    lines.push(
      `| ${r.domain} | ${score} | ${r.killed} | ${r.timedOut} | ${r.survived} | ${r.noCoverage} |`,
    );
  }
  for (const r of results) {
    if (r.survivors.length === 0) continue;
    lines.push("", `### Survivors: ${r.domain}`, "");
    for (const s of r.survivors.slice(0, survivorLimit)) {
      lines.push(`- ${s.file}:${s.line} ${s.mutator} → \`${s.replacement}\``);
    }
    const left = r.survivors.length - survivorLimit;
    if (left > 0) lines.push(`- ${left} more in the JSON report`);
  }
  return `${lines.join("\n")}\n`;
}
