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

export function sonarRules(_rules: PluginRule[], _profile: string[]): RuleSet {
  return { untyped: [], typed: [], unmatched: [] };
}

export function exclusionsOf(_properties: string): string[] {
  return [];
}

export function lintTargets(_paths: string[], _exclusions: string[]): string[] {
  return [];
}

export function applySuppressions(
  findings: Finding[],
  _linesOf: (file: string) => string[],
): Finding[] {
  return findings;
}

export function formatFindings(_findings: Finding[]): string {
  return "";
}
