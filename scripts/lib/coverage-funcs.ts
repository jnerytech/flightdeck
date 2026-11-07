import { testArgs } from "../test/timeout.ts";
import type { FunctionCoverage } from "./coverage-funcs-hooks.ts";
import { HEAVY_TESTS, heavyReasonGiven, heavyRunMessage } from "./slot-heavy.ts";
import { type Plan, SLOT_ABOVE, selectRelated } from "./test-related.ts";

export {
  COVERAGE_VAR,
  createInstrumenter,
  type FunctionCoverage,
  type Instrumenter,
  onLoadFor,
} from "./coverage-funcs-hooks.ts";

export const PRELOAD = "./scripts/test/coverage-funcs-preload.ts";

const slashes = (path: string) => path.replaceAll("\\", "/");

/** The functions that no test called, by line. */
export function uncalled(coverage: FunctionCoverage): Array<{ line: number; name: string }> {
  return Object.entries(coverage.fnMap)
    .filter(([id]) => coverage.f[id] === 0)
    .map(([, { line, name }]) => ({ line, name }))
    .sort((a, b) => a.line - b.line);
}

const LINE_MAX = 100;
const functions = (n: number) => `${n} ${n === 1 ? "function" : "functions"}`;

/**
 * One block per file: the count, then every function never called as `file:line  name`. Istanbul
 * does not name methods and arrows, so those show their source line instead.
 */
export function formatReport(
  targets: Array<{ file: string; source: string }>,
  coverage: Record<string, FunctionCoverage>,
): string {
  return targets
    .map(({ file, source }) => {
      const found = coverage[file];
      if (!found) return `${file}: no test loaded this file`;
      const total = Object.keys(found.fnMap).length;
      if (total === 0) return `${file}: no functions`;
      const missed = uncalled(found);
      if (missed.length === 0) return `${file}: all ${functions(total)} called`;
      const lines = source.split("\n");
      const shown = missed.map(({ line, name }) => {
        const text = name.startsWith("(anonymous_") ? (lines[line - 1] ?? "").trim() : name;
        const cut = text.length > LINE_MAX ? text.slice(0, LINE_MAX - 1) + "…" : text;
        return `  ${file}:${line}  ${cut}`;
      });
      return [`${file}: ${missed.length} of ${functions(total)} never called`, ...shown].join("\n");
    })
    .join("\n");
}

export interface CoveragePlanDeps {
  files: string[];
  /** Test files to run instead of the ones that import `files`, for a file every test reaches. */
  tests?: string[];
  platform: NodeJS.Platform;
  /** Runs git with the given arguments; `null` when git fails. */
  git: (args: string[]) => string | null;
  readFile: (path: string) => string;
  /** Where the preload writes the coverage JSON. */
  out: string;
  /**
   * The run's environment (#674): a plan over more than 20 test files is refused unless
   * FLIGHTDECK_SLOT_HEAVY gives a reason, from every session (#725).
   */
  env?: Record<string, string | undefined>;
}

export interface CoveragePlan extends Plan {
  /** Added to the environment of `command`: the preload reads the files and the output path from it. */
  env: Record<string, string>;
  /** A worker's plan over more than 20 test files (#674): refused, or let through on a reason. */
  slotHeavy?: "block" | "waived";
}

/** The tests that reach `files`, run with the preload that instruments them in memory. */
export function planCoverageFuncs({
  files,
  tests,
  platform,
  git,
  readFile,
  out,
  env,
}: CoveragePlanDeps): CoveragePlan {
  const fail = (output: string): CoveragePlan => ({ code: 2, output, command: null, env: {} });
  if (files.length === 0) return fail("usage: bun run coverage:funcs <file.ts>...");
  const clean = (list: string[]) => list.map((f) => slashes(f).replace(/^\.\//, ""));
  const targets = clean(files);
  const given = clean(tests ?? []);
  const tracked = (git(["ls-files", "*.ts", "*.tsx"]) ?? "").split("\n").filter(Boolean);
  const unknown = [...targets, ...given].filter((f) => !tracked.includes(f));
  if (unknown.length > 0) {
    return fail(`coverage:funcs: not a tracked .ts or .tsx file: ${unknown.join(", ")}`);
  }
  const related =
    given.length > 0
      ? given.map((path) => ({ path, why: "given" }))
      : selectRelated(targets, new Map(tracked.map((path) => [path, readFile(path)])));
  if (related.length === 0) {
    return {
      code: 0,
      output: `coverage:funcs: no test file reaches ${targets.join(", ")}`,
      command: null,
      env: {},
    };
  }
  // #674: a run over many test files holds the slot for what the PR's CI does anyway. #725: no
  // coordinator exemption here: this process's environment is the command's, which a worker sets
  // (export, --env-file); the guard hook reads the session's own. Everyone gives a reason.
  let slotHeavy: CoveragePlan["slotHeavy"];
  if (env && related.length > HEAVY_TESTS) {
    const reason = env.FLIGHTDECK_SLOT_HEAVY;
    if (reason === undefined || !heavyReasonGiven(reason)) {
      const what = `\`bun run coverage:funcs\` over ${related.length} test files`;
      return { ...fail(`coverage:funcs: ${heavyRunMessage(what)}`), slotHeavy: "block" };
    }
    slotHeavy = "waived";
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
    ...(slotHeavy ? { slotHeavy } : {}),
  };
}
