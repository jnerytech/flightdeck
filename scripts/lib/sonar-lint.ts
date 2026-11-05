import { byCodeUnit } from "@flightdeck/protocol";

export interface PluginRule {
  name: string;
  /** The rule's documentation URL, which carries its Sonar key (`.../S1186/javascript`). */
  url: string;
  typed: boolean;
}

export interface RuleSet {
  /** ESLint rule ids (`sonarjs/<name>`) that need no type information. */
  untyped: string[];
  /** ESLint rule ids that need the TypeScript program. */
  typed: string[];
  /** Profile keys (`S1234`) with no ESLint rule, so only SonarCloud can report them. */
  unmatched: string[];
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  message: string;
}

const KEY = /\/(S\d+)\//;
const SOURCE = /^(?:apps|packages|scripts)\/.+\.(?:tsx?|[cm]?js)$/;
const NOSONAR = /(?:\/\/|\/\*)\s*NOSONAR\b(.*)$/;

/** The rules the SonarCloud TypeScript profile activates that the sonarjs plugin implements. */
export function sonarRules(rules: PluginRule[], profile: string[]): RuleSet {
  const active = new Set(
    profile.filter((key) => key.startsWith("typescript:")).map((key) => key.slice(11)),
  );
  const set: RuleSet = { untyped: [], typed: [], unmatched: [] };
  const implemented = new Set<string>();
  for (const { name, url, typed } of rules) {
    const key = KEY.exec(url)?.[1];
    if (!key || !active.has(key)) continue;
    implemented.add(key);
    (typed ? set.typed : set.untyped).push(`sonarjs/${name}`);
  }
  set.unmatched = [...active].filter((key) => !implemented.has(key)).sort(byCodeUnit);
  return set;
}

/** The comma-separated globs of one property of a sonar-project.properties file. */
function listOf(properties: string, key: string): string[] {
  const line = properties.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).split(",") : [];
}

/** The `sonar.exclusions` globs of a sonar-project.properties file. */
export function exclusionsOf(properties: string): string[] {
  return listOf(properties, "sonar.exclusions");
}

/** `**` crosses folders, `*` stays inside one. */
function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/\*\*\/|\*\*|\*|[.+^${}()|[\]\\]/g, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(`^${body}$`);
}

/** The changed files SonarCloud would analyse as source code. */
export function lintTargets(paths: string[], exclusions: string[]): string[] {
  const excluded = exclusions.map(globToRegExp);
  return paths
    .filter((path) => SOURCE.test(path) && !excluded.some((re) => re.test(path)))
    .sort(byCodeUnit);
}

/**
 * Drops the findings on a line with a `NOSONAR` comment, as SonarCloud does. A NOSONAR with no
 * reason after it still silences the line, but is reported itself: a suppression says why.
 */
export function applySuppressions(
  findings: Finding[],
  linesOf: (file: string) => string[],
): Finding[] {
  const kept: Finding[] = [];
  const bare = new Map<string, Finding>();
  for (const finding of findings) {
    const rest = NOSONAR.exec(linesOf(finding.file)[finding.line - 1] ?? "")?.[1];
    if (rest === undefined) {
      kept.push(finding);
      continue;
    }
    const reason = rest
      .replace(/\*\/\s*$/, "")
      .replace(/^[\s:\-\u2013\u2014]+/, "")
      .trim();
    if (reason) continue;
    bare.set(`${finding.file}:${finding.line}`, {
      file: finding.file,
      line: finding.line,
      rule: "nosonar-reason",
      message: "NOSONAR needs a reason after it, for example `// NOSONAR: why`",
    });
  }
  return [...kept, ...bare.values()];
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "lint:sonar: no findings";
  const lines = [...findings]
    .sort((a, b) => a.file.localeCompare(b.file, "en") || a.line - b.line)
    .map((f) => `${f.file}:${f.line}  ${f.rule}  ${f.message}`);
  return [...lines, "", `lint:sonar: ${findings.length} finding(s)`].join("\n");
}

const FILE_HEADER = /^\+\+\+ b\/(.+)$/;
const HUNK = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/;

/** The added line numbers per file in a `git diff -U0` text. */
export function addedLines(diff: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>();
  let lines: Set<number> | null = null;
  for (const line of diff.split("\n")) {
    const file = FILE_HEADER.exec(line)?.[1];
    if (file) {
      lines = new Set();
      added.set(file, lines);
      continue;
    }
    const hunk = HUNK.exec(line);
    if (!hunk || !lines) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let n = start; n < start + count; n++) lines.add(n);
  }
  return added;
}

/** Keeps the findings on added lines (SonarCloud's new code); files not in `added` count whole. */
export function onlyNewCode(findings: Finding[], added: Map<string, Set<number>>): Finding[] {
  return findings.filter((f) => !added.has(f.file) || added.get(f.file)?.has(f.line));
}

/** Whether a Sonar glob (`**` crosses folders, `*` stays in one) matches a repository path. */
export function matchesGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/** The `sonar.test.inclusions` globs of a sonar-project.properties file. */
export function testInclusionsOf(properties: string): string[] {
  return listOf(properties, "sonar.test.inclusions");
}

/** Whether SonarCloud treats this file as test code. */
export function isTestFile(path: string, inclusions: string[]): boolean {
  return inclusions.some((glob) => matchesGlob(glob, path));
}

/** Whether SonarCloud reads this file's coverage: analysed, not a test, not coverage-excluded. */
export function countsForCoverage(path: string, properties: string): boolean {
  const any = (key: string) => listOf(properties, key).some((glob) => matchesGlob(glob, path));
  return (
    !any("sonar.exclusions") && !any("sonar.test.inclusions") && !any("sonar.coverage.exclusions")
  );
}

/** How many findings each rule has, for the per-rule ratchet. */
export function ruleCounts(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { rule } of findings) counts[rule] = (counts[rule] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => byCodeUnit(a, b)));
}
