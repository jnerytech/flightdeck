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
  set.unmatched = [...active].filter((key) => !implemented.has(key)).sort();
  return set;
}

/** The `sonar.exclusions` globs of a sonar-project.properties file. */
export function exclusionsOf(properties: string): string[] {
  const line = properties.split(/\r?\n/).find((l) => l.startsWith("sonar.exclusions="));
  return line ? line.slice("sonar.exclusions=".length).split(",") : [];
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
  return paths.filter((path) => SOURCE.test(path) && !excluded.some((re) => re.test(path))).sort();
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

/** The added line numbers per file in a `git diff -U0` text. */
export function addedLines(_diff: string): Map<string, Set<number>> {
  return new Map();
}

/** Keeps the findings on added lines (SonarCloud's new code); files not in `added` count whole. */
export function onlyNewCode(findings: Finding[], _added: Map<string, Set<number>>): Finding[] {
  return findings;
}
