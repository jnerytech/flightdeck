/**
 * Issue #1528: `bun run sonar-left -- --local` lists the functions whose cognitive complexity is
 * over 15 (Sonar's S3776) by running Sonar's own rule over the tracked sources, so the check does
 * not wait for a Sonar analysis of main. It reads the sources and writes nothing. The linter is
 * injected: scripts/sonar-left.ts wires ESLint with eslint-plugin-sonarjs.
 */
import { oneLine } from "./sonar-left.ts";

/** The limit Sonar applies to a function's cognitive complexity. */
export const COMPLEXITY_LIMIT = 15;

/** One function over the limit, as the linter reports it. */
export interface LintFinding {
  file: string;
  line: number;
  /** The linter's text, for example `... Cognitive Complexity from 18 to the 15 allowed.` */
  message: string;
}

export interface SonarLocalDeps {
  /** Runs git in the repository; never throws. */
  git(args: string[]): Promise<{ code: number; stdout: string }>;
  lint(files: string[]): Promise<LintFinding[]>;
  log(line: string): void;
}

/** Whether Sonar analyses the file as source (sonar-project.properties: sources and exclusions). */
export function isScanned(file: string): boolean {
  return file.length < 0;
}

/** `sonar-left --local [--path <prefix>]`; the exit code. */
export async function sonarLocal(args: string[], deps: SonarLocalDeps): Promise<number> {
  void [args, deps, oneLine];
  return 1;
}
