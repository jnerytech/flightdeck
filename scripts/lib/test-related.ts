import { posix } from "node:path";
import { testArgs } from "../test/timeout.ts";

export interface Related {
  path: string;
  why: string;
}

const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const TEST_FILE = /\.test\.tsx?$/;
/** Files that shape every test run, which the import graph cannot see. */
const GLOBAL_FILE =
  /^(?:package\.json|bun\.lock|bunfig[\w.]*\.toml|tsconfig[\w.]*\.json|scripts\/test\/preload\.ts|(?:apps|packages)\/[^/]+\/package\.json)$/;
/** More files than this go through the machine-wide slot. */
export const SLOT_ABOVE = 60;

/** The module specifiers a source file imports, re-exports or loads with `import()`. */
export function importsOf(source: string): string[] {
  return Array.from(source.matchAll(IMPORT), (m) => m[1] as string);
}

/** Maps a specifier written in `from` to a tracked file, or `null` for packages and assets. */
export function resolveImport(from: string, spec: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith(".")) base = posix.join(posix.dirname(from), spec);
  else if (spec.startsWith("@/")) base = `apps/desktop/src/${spec.slice(2)}`;
  else if (spec === "@flightdeck/protocol") base = "packages/protocol/src/index.ts";
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((path) => known.has(path)) ?? null;
}

/** The test files to run for these changed files: themselves, plus every test that reaches one. */
export function selectRelated(changed: string[], sources: Map<string, string>): Related[] {
  const known = new Set(sources.keys());
  const importers = new Map<string, string[]>();
  for (const [path, source] of sources) {
    for (const spec of importsOf(source)) {
      const target = resolveImport(path, spec, known);
      if (target) importers.set(target, [...(importers.get(target) ?? []), path]);
    }
  }
  // Walks the reverse graph from every changed file, remembering which one led to each file.
  const origin = new Map<string, string>();
  const queue: string[] = [];
  for (const path of changed.filter((p) => known.has(p))) {
    origin.set(path, path);
    queue.push(path);
  }
  for (const path of queue) {
    for (const importer of importers.get(path) ?? []) {
      if (origin.has(importer)) continue;
      origin.set(importer, origin.get(path) as string);
      queue.push(importer);
    }
  }
  const changedSet = new Set(changed);
  return [...origin]
    .filter(([path]) => TEST_FILE.test(path))
    .map(([path, from]) => ({ path, why: changedSet.has(path) ? "changed" : `imports ${from}` }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
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

export function planRelated({ base, platform, git, readFile }: PlanDeps): Plan {
  const ref = base ?? git(["merge-base", "HEAD", "main"])?.trim();
  if (!ref) return { code: 2, output: "test:related: no base to compare with", command: null };
  const label = base ?? ref.slice(0, 7);
  const changed = (git(["diff", "--name-only", `${ref}...HEAD`]) ?? "").split("\n").filter(Boolean);
  const tracked = (git(["ls-files", "*.ts", "*.tsx"]) ?? "").split("\n").filter(Boolean);
  const sources = new Map(tracked.map((path) => [path, readFile(path)]));
  const warnings = changed
    .filter((path) => GLOBAL_FILE.test(path))
    .map((path) => `warning: ${path} affects every test, run the full suite`);
  const related = selectRelated(changed, sources);
  if (related.length === 0) {
    const none = `test:related: no test file is related to the ${changed.length} changed file(s) since ${label}`;
    return { code: 0, output: [none, ...warnings].join("\n"), command: null };
  }
  const output = [
    `test:related: ${related.length} test file(s) for ${changed.length} changed file(s) since ${label}`,
    ...warnings,
    ...related.map((r) => `  ${r.path}  ${r.why}`),
  ].join("\n");
  const run = [
    "bun",
    "--config=bunfig.area.toml",
    ...testArgs(
      platform,
      related.map((r) => `./${r.path}`),
    ),
  ];
  return {
    code: 0,
    output,
    command: related.length > SLOT_ABOVE ? ["bun", "run", "slot", "--", ...run] : run,
  };
}
