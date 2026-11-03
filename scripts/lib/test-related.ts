export interface Related {
  path: string;
  why: string;
}

/** The module specifiers a source file imports, re-exports or loads with `import()`. */
export function importsOf(_source: string): string[] {
  return ["stub"];
}

/** Maps a specifier written in `from` to a tracked file, or `null` for packages and assets. */
export function resolveImport(_from: string, _spec: string, _known: Set<string>): string | null {
  return "stub";
}

/** The test files to run for these changed files: themselves, plus every test that reaches one. */
export function selectRelated(_changed: string[], _sources: Map<string, string>): Related[] {
  return [{ path: "stub", why: "stub" }];
}

export interface PlanDeps {
  /** Value of `--base`, if given. */
  base?: string;
  platform: NodeJS.Platform;
  /** Runs git with the given arguments; `null` when git fails. */
  git: (args: string[]) => string | null;
  readFile: (path: string) => string;
}

export interface Plan {
  code: number;
  output: string;
  /** The command to run, or `null` when there is nothing to run. */
  command: string[] | null;
}

export function planRelated(_deps: PlanDeps): Plan {
  return { code: 1, output: "stub", command: ["stub"] };
}
