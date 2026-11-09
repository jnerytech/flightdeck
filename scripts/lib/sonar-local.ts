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

/** Where Sonar looks for source (sonar-project.properties: sonar.sources). */
const SOURCE_ROOTS = ["apps/", "packages/", "scripts/"];

/** What Sonar does not analyse as source: sonar.test.inclusions and sonar.exclusions. */
const NOT_SOURCE = [
  /(^|\/)test\//,
  /\.test\.tsx?$/,
  /^scripts\/e2e\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /^apps\/desktop\/src-tauri\/(target|gen)\//,
  /^apps\/desktop\/screenshots\//,
  /^apps\/desktop\/src\/components\/ui\//,
];

/** Whether Sonar analyses the file as source (sonar-project.properties: sources and exclusions). */
export function isScanned(file: string): boolean {
  return (
    SOURCE_ROOTS.some((root) => file.startsWith(root)) &&
    /\.tsx?$/.test(file) &&
    !NOT_SOURCE.some((pattern) => pattern.test(file))
  );
}

/** `sonar-left --local [--path <prefix>]`; the exit code. */
export async function sonarLocal(args: string[], deps: SonarLocalDeps): Promise<number> {
  const at = args.indexOf("--path");
  const prefix = (at === -1 ? undefined : args[at + 1]) ?? "";
  const listed = await deps.git(["ls-files", "-z"]);
  if (listed.code !== 0) {
    deps.log("sonar-left --local: git could not list the tracked files");
    return 1;
  }
  const files = listed.stdout
    .split(/[\0\n]/)
    .filter((file) => isScanned(file) && file.startsWith(prefix));
  let found: LintFinding[];
  try {
    found = await deps.lint(files);
  } catch (error) {
    deps.log(oneLine(`sonar-left --local: ${(error as Error).message}`));
    return 1;
  }
  const sorted = [...found].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  deps.log(
    `${sorted.length} functions over ${COMPLEXITY_LIMIT} (local run of Sonar's S3776 rule; Sonar's own list is \`sonar-left\`)`,
  );
  for (const one of sorted) {
    deps.log(oneLine(`CRITICAL typescript:S3776 ${one.file}:${one.line} ${one.message}`));
  }
  return 0;
}
