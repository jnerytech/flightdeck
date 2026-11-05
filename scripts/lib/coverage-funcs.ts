import { createInstrumenter as createIstanbulInstrumenter } from "istanbul-lib-instrument";
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

/**
 * Istanbul's instrumenter, which parses TypeScript through Babel. A `.tsx` file needs the JSX
 * plugin and a `.ts` file must not have it (`<T>(a) => a` would read as a tag), so there are two.
 * The path given is what the coverage is keyed by.
 */
export function createInstrumenter(): Instrumenter {
  const make = (parserPlugins: Array<"typescript" | "jsx">) =>
    createIstanbulInstrumenter({ esModules: true, coverageVariable: COVERAGE_VAR, parserPlugins });
  const ts = make(["typescript"]);
  const tsx = make(["typescript", "jsx"]);
  return (code, file) => (file.endsWith("x") ? tsx : ts).instrumentSync(code, file);
}

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

const slashes = (path: string) => path.replaceAll("\\", "/");

const escaped = (path: string) =>
  path.replace(/[.*+?^${}()|[\]\\/]/g, (c) => (c === "/" ? String.raw`[\\/]` : `\\${c}`));

/**
 * What the preload registers with `Bun.plugin`: a filter for the listed files (any root, either
 * separator) and a loader that hands Bun the instrumented text. The sources on disk stay as they are.
 */
export function onLoadFor(
  files: string[],
  instrument: Instrumenter,
  read: (path: string) => string,
): {
  filter: RegExp;
  load: (path: string) => { contents: string; loader: "ts" | "tsx" } | undefined;
} {
  const filter = new RegExp(String.raw`(?:^|[\\/])(?:${files.map(escaped).join("|")})$`);
  return {
    filter,
    load(path) {
      const unix = slashes(path);
      const file = files.find((f) => unix === f || unix.endsWith(`/${f}`));
      if (!file) return undefined;
      return { contents: instrument(read(path), file), loader: file.endsWith("x") ? "tsx" : "ts" };
    },
  };
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
}

export interface CoveragePlan extends Plan {
  /** Added to the environment of `command`: the preload reads the files and the output path from it. */
  env: Record<string, string>;
}

/** The tests that reach `files`, run with the preload that instruments them in memory. */
export function planCoverageFuncs({
  files,
  tests,
  platform,
  git,
  readFile,
  out,
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
