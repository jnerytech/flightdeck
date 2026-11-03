import type { Plan } from "./test-related.ts";

/** The slice of Babel this tool uses (Playwright ships a bundled copy). */
export interface Babel {
  // biome-ignore lint/suspicious/noExplicitAny: Babel's AST types are not available here.
  babelParse: (code: string, file: string, typescript: boolean) => any;
  // biome-ignore lint/suspicious/noExplicitAny: Babel's AST types are not available here.
  traverse: (ast: any, visitors: Record<string, (path: any) => void>) => void;
}

/** A function in a source file, 1-based line and 0-based column as Babel reports them. */
export interface Site {
  file: string;
  line: number;
  column: number;
}

/** The global the markers call. Absent outside a `coverage:funcs` run, where the call is skipped. */
export const HOOK = "__coverageFuncs";
export const PRELOAD = "./scripts/test/coverage-funcs-preload.ts";

export const siteKey = (_site: Site): string => "";

export function loadBabel(): Babel {
  return {} as Babel;
}

export function instrument(
  _source: string,
  _file: string,
  _babel: Babel,
): { code: string; sites: Site[] } {
  return { code: "", sites: [] };
}

export function hitRecorder(_append: (line: string) => void): (key: string) => void {
  return () => {};
}

export function parseHits(_log: string): Set<string> {
  return new Set();
}

export function uncalled(_sites: Site[], _hits: Set<string>): Site[] {
  return [];
}

export interface Target {
  file: string;
  source: string;
  sites: Site[];
}

export function formatReport(_targets: Target[], _hits: Set<string>): string {
  return "";
}

export function onLoadFor(
  _files: string[],
  _babel: Babel,
  _read: (path: string) => string,
): {
  filter: RegExp;
  load: (path: string) => { contents: string; loader: "ts" | "tsx" } | undefined;
} {
  return { filter: /$^/, load: () => undefined };
}

export interface CoveragePlanDeps {
  files: string[];
  platform: NodeJS.Platform;
  git: (args: string[]) => string | null;
  readFile: (path: string) => string;
  log: string;
}

export interface CoveragePlan extends Plan {
  env: Record<string, string>;
}

export function planCoverageFuncs(_deps: CoveragePlanDeps): CoveragePlan {
  return { code: 1, output: "", command: null, env: {} };
}
