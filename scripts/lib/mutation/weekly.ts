import type { DomainResult, MutationDomain, MutationReport } from "./report.ts";

/** The effects of the weekly run (#1607): scripts/mutation-weekly.ts wires the real ones. */
export interface WeeklyDeps {
  domains: MutationDomain[];
  /** The settings every domain shares: the command runner, the timeout, the reporters. */
  base: Record<string, unknown>;
  writeConfig: (path: string, text: string) => void;
  /** Runs `stryker run <config>`; returns its exit status. */
  runStryker: (configPath: string) => number;
  /** The JSON report of a domain, or null when the run left none. */
  readReport: (domain: MutationDomain) => MutationReport | null;
}

export interface WeeklyOutcome {
  results: DomainResult[];
  /** Domains whose run exited non-zero or left no report: they have no score this week. */
  failed: string[];
}

export function runWeekly(_deps: WeeklyDeps): WeeklyOutcome {
  return { results: [], failed: [] };
}

export function configPathFor(_domain: MutationDomain): string {
  return "";
}
