import { testArgs } from "../test/timeout.ts";
import { type Plan, SLOT_ABOVE, selectRelated } from "./test-related.ts";

/** The slice of istanbul's file coverage this tool reads. */
export interface FunctionCoverage {
  fnMap: Record<string, { name: string; line: number }>;
  /** Calls per function id. */
  f: Record<string, number>;
}

/** The global istanbul keeps its counters in, by file. */
export const COVERAGE_VAR = "__coverageFuncs";
export const PRELOAD = "./scripts/test/coverage-funcs-preload.ts";

export type Instrumenter = (code: string, file: string) => string;

export function createInstrumenter(): Instrumenter {
  return () => "";
}

export function uncalled(_coverage: FunctionCoverage): Array<{ line: number; name: string }> {
  return [];
}

export function formatReport(
  _targets: Array<{ file: string; source: string }>,
  _coverage: Record<string, FunctionCoverage>,
): string {
  return "";
}

export function onLoadFor(
  _files: string[],
  _instrument: Instrumenter,
  _read: (path: string) => string,
): {
  filter: RegExp;
  load: (path: string) => { contents: string; loader: "ts" | "tsx" } | undefined;
} {
  return { filter: /$^/, load: () => undefined };
}

const slashes = (path: string) => path.replaceAll("\\", "/");

export interface CoveragePlanDeps {
  files: string[];
  platform: NodeJS.Platform;
  /** Runs git with the given arguments; `null` when git fails. */
  git: (args: string[]) => string | null;
  readFile: (path: string) => string;
  /** Where the preload writes the coverage JSON. */
  out: string;
}

export interface CoveragePlan extends Plan {
  /** Added to the environment of `command`: the preload reads the files and the output path from it. */
  env: Record<string, string>;
}

/** The tests that reach `files`, run with the preload that instruments them in memory. */
export function planCoverageFuncs({
  files,
  platform,
  git,
  readFile,
  out,
}: CoveragePlanDeps): CoveragePlan {
  const fail = (output: string): CoveragePlan => ({ code: 2, output, command: null, env: {} });
  if (files.length === 0) return fail("usage: bun run coverage:funcs <file.ts>...");
  const targets = files.map((f) => slashes(f).replace(/^\.\//, ""));
  const tracked = (git(["ls-files", "*.ts", "*.tsx"]) ?? "").split("\n").filter(Boolean);
  const unknown = targets.filter((f) => !tracked.includes(f));
  if (unknown.length > 0) {
    return fail(`coverage:funcs: not a tracked .ts or .tsx file: ${unknown.join(", ")}`);
  }
  const related = selectRelated(targets, new Map(tracked.map((path) => [path, readFile(path)])));
  if (related.length === 0) {
    return {
      code: 0,
      output: `coverage:funcs: no test file reaches ${targets.join(", ")}`,
      command: null,
      env: {},
    };
  }
  const run = [
    "bun",
    "--config=bunfig.area.toml",
    ...testArgs(platform, ["--preload", PRELOAD, ...related.map((r) => `./${r.path}`)]),
  ];
  return {
    code: 0,
    output: [
      `coverage:funcs: ${related.length} test file(s) for ${targets.length} file(s)`,
      ...related.map((r) => `  ${r.path}  ${r.why}`),
    ].join("\n"),
    command: related.length > SLOT_ABOVE ? ["bun", "run", "slot", "--", ...run] : run,
    env: { COVERAGE_FUNCS_FILES: JSON.stringify(targets), COVERAGE_FUNCS_OUT: out },
  };
}
