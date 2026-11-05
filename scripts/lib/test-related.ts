import { posix } from "node:path";
import { testArgs } from "../test/timeout.ts";
import { coverageTargets } from "./related-coverage.ts";

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
  /** Collect coverage of the run into this folder, and name the changed files it must cover. */
  coverageDir?: string;
}

export interface Plan {
  code: number;
  output: string;
  /** The command to run, or `null` when there is nothing to run. */
  command: string[] | null;
  /** The changed source files the run must cover at 100%; only when coverage was asked for. */
  targets?: string[];
}

export function planRelated({ base, platform, git, readFile, coverageDir }: PlanDeps): Plan {
  const ref = base ?? git(["merge-base", "HEAD", "main"])?.trim();
  if (!ref) return { code: 2, output: "test:related: no base to compare with", command: null };
  const label = base ?? ref.slice(0, 7);
  const changed = (git(["diff", "--name-only", `${ref}...HEAD`]) ?? "").split("\n").filter(Boolean);
  const tracked = (git(["ls-files", "*.ts", "*.tsx"]) ?? "").split("\n").filter(Boolean);
  const sources = new Map(tracked.map((path) => [path, readFile(path)]));
  const warnings = changed
    .filter((path) => GLOBAL_FILE.test(path))
    .map((path) => `warning: ${path} affects every test, run the full suite`);
  const byImport = selectRelated(changed, sources);
  const imported = new Set(byImport.map((r) => r.path));
  const related = [
    ...byImport,
    ...selectByPath(changed, sources).filter((r) => !imported.has(r.path)),
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  const targets = coverageDir
    ? coverageTargets(changed, (path) => (sources.has(path) ? (sources.get(path) ?? null) : null))
    : undefined;
  if (related.length === 0 && targets && targets.length > 0) {
    const lines = targets.map((path) => `  ${path}: no related test loads this file`);
    const output = [
      `test:related: ${targets.length} changed source file(s) with no test`,
      ...lines,
    ];
    return { code: 1, output: output.join("\n"), command: null, targets };
  }
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
    // The area config turns coverage off; the related one turns it on without the 100% gate.
    coverageDir ? "--config=bunfig.related.toml" : "--config=bunfig.area.toml",
    ...testArgs(platform, [
      ...(coverageDir ? [`--coverage-dir=${coverageDir}`] : []),
      ...related.map((r) => `./${r.path}`),
    ]),
  ];
  return {
    code: 0,
    output,
    command: related.length > SLOT_ABOVE ? ["bun", "run", "slot", "--", ...run] : run,
    ...(targets ? { targets } : {}),
  };
}

/**
 * The tests that name a changed file, or one of its folders, as a string literal: the data files,
 * configs and spawned entries a test reads without importing them.
 */
export function selectByPath(changed: string[], sources: Map<string, string>): Related[] {
  const tests = [...sources].filter(([path]) => TEST_FILE.test(path));
  const found = new Map<string, string>();
  for (const path of changed) {
    // The path itself, then its folders, most specific first. A name with no slash (a root file,
    // a top-level folder) is a word in a test, not a path; a baseline also counts by its own name.
    const names = [path];
    if (path.endsWith("-baseline.json")) names.push(posix.basename(path));
    for (let dir = posix.dirname(path); dir !== "."; dir = posix.dirname(dir)) names.push(dir);
    const paths = names.filter((n) => n.includes("/") || n.endsWith("-baseline.json"));
    for (const [test, source] of tests) {
      if (found.has(test)) continue;
      const name = paths.find((n) => new RegExp(`["'\`]${escapeRegExp(n)}["'\`]`).test(source));
      if (name) found.set(test, `names ${name}`);
    }
  }
  // In the sources' order; planRelated sorts what it runs.
  return [...found].map(([path, why]) => ({ path, why }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
