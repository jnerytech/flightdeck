import { posix } from "node:path";
import { testArgs } from "../test/timeout.ts";
import { coverageTargets } from "./related-coverage.ts";
import { auditBase } from "./tdd-audit.ts";

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
  else if (spec.startsWith("@flightdeck/")) {
    // A workspace package (packages/<name>/src), whole or by subpath: no internal import is lost.
    const [, name = "", ...sub] = spec.split("/");
    base =
      sub.length > 0 ? `packages/${name}/src/${sub.join("/")}` : `packages/${name}/src/index.ts`;
  } else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((path) => known.has(path)) ?? null;
}

/** For each tracked file, the files that import it. */
function importersOf(sources: Map<string, string>, known: Set<string>): Map<string, string[]> {
  const importers = new Map<string, string[]>();
  for (const [path, source] of sources) {
    for (const spec of importsOf(source)) {
      const target = resolveImport(path, spec, known);
      if (target) importers.set(target, [...(importers.get(target) ?? []), path]);
    }
  }
  return importers;
}

/** The test files to run for these changed files: themselves, plus every test that reaches one. */
export function selectRelated(
  changed: string[],
  sources: Map<string, string>,
  { direct = false }: { direct?: boolean } = {},
): Related[] {
  const known = new Set(sources.keys());
  const importers = importersOf(sources, known);
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
      // `direct` stops at the files that import a changed file themselves.
      if (!direct) queue.push(importer);
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
  /** `--fast`: only the tests that import a changed file directly (the transitive set runs in CI). */
  fast?: boolean;
  /** `--tier unit,component`: only the tests of these tiers (#261); the 100% gate stays in CI. */
  tiers?: string[];
  /** A test file's tier (lib/test-tiers.ts); undefined for a file it does not classify. */
  tierOf?: (path: string) => string | undefined;
  /**
   * `--pr` (#309): every unit and component test, plus the related tests of the other tiers, with
   * the per-changed-file 100% gate. The full suite runs on main and nightly.
   */
  pyramid?: boolean;
  /** False keeps a big run out of the machine-wide slot (CI has the machine to itself). */
  slot?: boolean;
}

export interface Plan {
  code: number;
  output: string;
  /** The command to run, or `null` when there is nothing to run. */
  command: string[] | null;
  /** The changed source files the run must cover at 100%; only when coverage was asked for. */
  targets?: string[];
  /**
   * The test files the run holds, or "all" when the whole suite runs: what `--list` writes for the
   * Windows shards of a PR (#399).
   */
  files?: string[] | "all";
}

export function planRelated({
  base,
  platform,
  git,
  readFile,
  coverageDir: asked,
  fast,
  tiers,
  tierOf = () => undefined,
  pyramid = false,
  slot = true,
}: PlanDeps): Plan {
  // A run of some tiers covers only part of a file: the 100% gate is the full run's (CI).
  const coverageDir = tiers ? undefined : asked;
  // The same base as tdd:audit (origin/main first); the local main only when that gives none.
  const ref = base ?? auditBase(git) ?? git(["merge-base", "HEAD", "main"])?.trim();
  if (!ref) return { code: 2, output: "test:related: no base to compare with", command: null };
  const label = base ?? ref.slice(0, 7);
  // --no-renames: a renamed file shows its old path as gone, so a renamed test counts as removed.
  const changed = (git(["diff", "--name-only", "--no-renames", `${ref}...HEAD`]) ?? "")
    .split("\n")
    .filter(Boolean);
  const tracked = (git(["ls-files", "*.ts", "*.tsx"]) ?? "").split("\n").filter(Boolean);
  const sources = new Map(tracked.map((path) => [path, readFile(path)]));
  const warnings = changed
    .filter((path) => GLOBAL_FILE.test(path))
    .map((path) => `warning: ${path} affects every test, run the full suite`);
  // --pr: a file every test reads, or a test that went away, can lower coverage of any file: the
  // whole suite runs, with its whole-repo gate (#309).
  if (pyramid) {
    const removedTest = changed.find((path) => TEST_FILE.test(path) && !sources.has(path));
    const global = changed.find((path) => GLOBAL_FILE.test(path));
    const why = global
      ? `${global} affects every test`
      : removedTest
        ? `${removedTest} went away`
        : null;
    if (why) {
      const whole = ["bun", "run", "test"];
      return {
        code: 0,
        output: `test:related --pr: the whole suite runs (${why})`,
        command: slot ? ["bun", "run", "slot", "--", ...whole] : whole,
        files: "all",
      };
    }
  }
  const byImport = selectRelated(changed, sources, { direct: fast });
  const imported = new Set(byImport.map((r) => r.path));
  const selected = [
    ...byImport,
    ...selectByPath(changed, sources).filter((r) => !imported.has(r.path)),
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  // --tier: a test with no tier still runs, never silently dropped.
  const kept = (path: string) => {
    const tier = tierOf(path);
    return !tiers || tier === undefined || tiers.includes(tier);
  };
  // The mods' tests run under `claude plugin test`; every bunfig ignores mods/, so none is selected.
  const related = (
    pyramid ? pyramidTests(selected, tracked, tierOf) : selected.filter((r) => kept(r.path))
  ).filter((r) => !r.path.startsWith("mods/"));
  const out = new Map<string, number>();
  for (const r of selected.filter((r) => !kept(r.path))) {
    const tier = tierOf(r.path) as string;
    out.set(tier, (out.get(tier) ?? 0) + 1);
  }
  if (tiers && out.size > 0) {
    const counts = [...out].map(([tier, n]) => `${tier} ${n}`).join(", ");
    warnings.push(
      `--tier ${tiers.join(",")}: ${selected.length - related.length} test file(s) left out (${counts}); CI runs every tier and the coverage gate`,
    );
  }
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
  if (related.length === 0 && !pyramid) {
    const none = `test:related: no test file is related to the ${changed.length} changed file(s) since ${label}`;
    return { code: 0, output: [none, ...warnings].join("\n"), command: null };
  }
  const fastTier = related.filter((r) => FAST_TIERS.has(tierOf(r.path) ?? "")).length;
  const output = [
    pyramid
      ? `test:related --pr: ${fastTier} fast-tier test file(s) + ${related.length - fastTier} related test file(s) of the other tiers for ${changed.length} changed file(s) since ${label}`
      : fast
        ? `test:related --fast: ${related.length} test file(s) for ${changed.length} changed file(s) since ${label} (direct importers only; CI runs the rest)`
        : `test:related: ${related.length} test file(s) for ${changed.length} changed file(s) since ${label}`,
    ...warnings,
    // --pr lists the related tests; the fast tiers are counted in the header, not listed.
    ...related
      .filter((r) => !pyramid || !FAST_TIERS.has(tierOf(r.path) ?? ""))
      .map((r) => `  ${r.path}  ${r.why}`),
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
    command: slot && related.length > SLOT_ABOVE ? ["bun", "run", "slot", "--", ...run] : run,
    files: related.map((r) => r.path),
    ...(targets ? { targets } : {}),
  };
}

/**
 * `--list <file>` (#399): writes the plan's selection, one test file per line or `*` for the whole
 * suite, and gives the exit code and the line to print. A missing file name is the usage (2).
 */
export function listSelection(
  plan: Plan,
  list: string | undefined,
  write: (path: string, text: string) => void,
): { code: number; line: string } {
  if (!list || list.startsWith("--")) {
    return { code: 2, line: "test:related: --list needs a file to write the selection to" };
  }
  const files = plan.files === "all" ? ["*"] : (plan.files ?? []);
  write(list, files.map((file) => `${file}\n`).join(""));
  return { code: plan.code, line: `test:related: ${files.length} line(s) written to ${list}` };
}

/** The tiers a PR runs whole (#309): the cheap base of the pyramid. */
const FAST_TIERS = new Set(["unit", "component"]);

/** `--pr`: every fast-tier test of the tree, and the related tests of the other tiers (or none). */
function pyramidTests(
  related: Related[],
  tracked: string[],
  tierOf: (path: string) => string | undefined,
): Related[] {
  const chosen = new Map(related.map((r) => [r.path, r]));
  for (const path of tracked) {
    if (TEST_FILE.test(path) && FAST_TIERS.has(tierOf(path) ?? "") && !chosen.has(path)) {
      chosen.set(path, { path, why: `${tierOf(path)} tier` });
    }
  }
  return [...chosen.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
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

/** Why a `--keep-coverage` value cannot be the kept coverage folder, or null (#309). */
export function keepCoverageProblem(root: string, value: string | undefined): string | null {
  const refuse = `--keep-coverage needs a folder inside the repository, got ${value ?? "nothing"}`;
  // A flag, a Windows drive path (D:/x, C:x) or a leading slash is never a folder of the repository.
  if (value === undefined || /^(?:-|[A-Za-z]:|[\\/])/.test(value)) return refuse;
  const inside = posix.relative(root, posix.resolve(root, value));
  if (inside === "" || inside === ".." || inside.startsWith("../") || posix.isAbsolute(inside)) {
    return refuse;
  }
  return null;
}
