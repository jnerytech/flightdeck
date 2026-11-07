/**
 * What the coverage:funcs preload needs to instrument files as they load (#296: split from
 * coverage-funcs.ts). It imports only istanbul, so the preload loads no repo source before its
 * plugin registers, and the sharded suite's istanbul job sees every source.
 */
import { createInstrumenter as createIstanbulInstrumenter } from "istanbul-lib-instrument";

/** The slice of istanbul's file coverage this tool reads. */
export interface FunctionCoverage {
  fnMap: Record<string, { name: string; line: number }>;
  /** Calls per function id. */
  f: Record<string, number>;
}

/** The global istanbul keeps its counters in, by file. */
export const COVERAGE_VAR = "__coverageFuncs";

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

const slashes = (path: string) => path.replaceAll("\\", "/");

const escaped = (path: string) =>
  path.replace(/[.*+?^${}()|[\]\\/]/g, (c) => (c === "/" ? String.raw`[\\/]` : `\\${c}`));

/**
 * What the preload registers with `Bun.plugin`: a filter for the listed files (any root, either
 * separator) and a loader that hands Bun the instrumented text. The sources on disk stay as they are.
 * The counters live in `counters`, which the loader puts back as the global before each file runs:
 * a test that deletes the global cannot take the files loaded before it out of the report.
 */
export function onLoadFor(
  files: string[],
  instrument: Instrumenter,
  read: (path: string) => string,
): {
  filter: RegExp;
  load: (path: string) => { contents: string; loader: "ts" | "tsx" } | undefined;
  counters: Record<string, FunctionCoverage>;
} {
  const filter = new RegExp(String.raw`(?:^|[\\/])(?:${files.map(escaped).join("|")})$`);
  const counters: Record<string, FunctionCoverage> = {};
  return {
    filter,
    counters,
    load(path) {
      const unix = slashes(path);
      const file = files.find((f) => unix === f || unix.endsWith(`/${f}`));
      if (!file) return undefined;
      (globalThis as Record<string, unknown>)[COVERAGE_VAR] = counters;
      return { contents: instrument(read(path), file), loader: file.endsWith("x") ? "tsx" : "ts" };
    },
  };
}
