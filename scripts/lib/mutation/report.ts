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

export function scoreReport(_report: MutationReport): MutationCounts {
  return { killed: 0, timedOut: 0, survived: 0, noCoverage: 0, score: null };
}

export function survivorsOf(_report: MutationReport): Survivor[] {
  return [];
}

export function strykerConfigFor(
  _domain: MutationDomain,
  _base: Record<string, unknown>,
): Record<string, unknown> {
  return {};
}

export function summaryMarkdown(_results: DomainResult[], _survivorLimit: number): string {
  return "";
}
