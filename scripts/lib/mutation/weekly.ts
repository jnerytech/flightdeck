import {
  type DomainResult,
  type MutationDomain,
  type MutationReport,
  scoreReport,
  strykerConfigFor,
  survivorsOf,
} from "./report.ts";

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
  /** Domains whose score is under their `minScore` baseline. */
  belowBaseline: { domain: string; score: number | null; minScore: number }[];
}

export function configPathFor(domain: MutationDomain): string {
  return `reports/mutation/${domain.name}/stryker.config.json`;
}

const SAFE_NAME = /^[a-z0-9-]+$/;
const SAFE_PATH = /^[\w./-]+$/;

/** The name makes folder names and the paths join into a shell command: refuse what could escape. */
function assertSafe(domain: MutationDomain): void {
  const paths = [...domain.mutate, ...domain.tests];
  const unsafePath = paths.find((path) => !SAFE_PATH.test(path) || path.split("/").includes(".."));
  const badScore =
    domain.minScore !== undefined &&
    !(typeof domain.minScore === "number" && domain.minScore >= 0 && domain.minScore <= 100);
  if (!SAFE_NAME.test(domain.name) || unsafePath !== undefined || badScore) {
    throw new Error(`unsafe mutation domain: ${domain.name} ${unsafePath ?? ""}`.trim());
  }
}

export function runWeekly(deps: WeeklyDeps): WeeklyOutcome {
  for (const domain of deps.domains) assertSafe(domain);
  const results: DomainResult[] = [];
  const failed: string[] = [];
  const belowBaseline: WeeklyOutcome["belowBaseline"] = [];
  for (const domain of deps.domains) {
    const configPath = configPathFor(domain);
    deps.writeConfig(
      configPath,
      `${JSON.stringify(strykerConfigFor(domain, deps.base), null, 2)}\n`,
    );
    const report = deps.runStryker(configPath) === 0 ? deps.readReport(domain) : null;
    if (report === null) {
      failed.push(domain.name);
      continue;
    }
    const counts = scoreReport(report);
    results.push({ domain: domain.name, ...counts, survivors: survivorsOf(report) });
    if (
      domain.minScore !== undefined &&
      (counts.score === null || counts.score < domain.minScore)
    ) {
      belowBaseline.push({ domain: domain.name, score: counts.score, minScore: domain.minScore });
    }
  }
  return { results, failed, belowBaseline };
}

/** The weekly run is red when a domain failed to run or fell under its baseline. */
export function exitCodeOf(outcome: WeeklyOutcome): number {
  return outcome.failed.length > 0 || outcome.belowBaseline.length > 0 ? 1 : 0;
}
