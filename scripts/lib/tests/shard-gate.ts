/**
 * The coverage gate (80% per file since #1002) of a suite run in shards (#296). Each shard runs twice, in jobs of its own:
 * once with Bun's coverage (the lines, and the lcov SonarCloud reads) and once with istanbul's
 * function maps (Bun's lcov counts functions but does not name them, so counts cannot merge). The
 * gate fails closed: a shard missing, doubled, failed or short of the suite's test files means no
 * verdict at all, never a pass.
 */

import { isAbsolute, join, relative, resolve } from "node:path";
import { testArgs } from "../../test/timeout.ts";
import {
  belowGate,
  COVERAGE_GATE,
  checkCoverage,
  type FileCoverage,
} from "../coverage-gate/check.ts";
import type { FunctionCoverage } from "../coverage-gate/funcs.ts";
import { fastCoverageVerdict } from "./fast-coverage.ts";
import { pyramidOf, renderPyramid } from "./pyramid-table.ts";
import { WHOLE_SUITE_IGNORED } from "./related-coverage.ts";
import { TEST_FILE } from "./test-related.ts";
import { splitShards, type Timings, testFiles } from "./test-shards.ts";
import type { Tier } from "./test-tiers.ts";
import { FAST_SHARDS, TIER_GROUPS, TIER_SHARDS, tierShard, tierShardFiles } from "./tier-shards.ts";

/** What each shard job writes next to its data. */
export interface ShardMarker {
  shard: number;
  of: number;
  kind: "bun" | "istanbul";
  /** The test files the job ran. */
  files: string[];
  exit: number;
  /** Failed tests. */
  fail: number;
  /** The tier group and part the job ran, as its name says it: `unit + component 1/2` (#1854). */
  tier?: string;
  /** How long the test run took, in seconds (#1854). */
  seconds?: number;
}

export interface ShardJob {
  marker: ShardMarker | null;
  /** The Bun job's lcov text, or the istanbul job's counters as JSON; null when missing. */
  data: string | null;
}

export interface GateInput {
  shards: number;
  /** Every test file of the suite: the shards together must run exactly these. */
  tests: readonly string[];
  jobs: readonly ShardJob[];
  /** The source files that must be loaded and covered (check-coverage.ts). */
  sources: readonly string[];
  /** Only these shards (1-based) are collected, as the fast-coverage ratchet reads the base's (#1854). */
  shardsOf?: readonly number[];
  /**
   * A PR's selection (#1761): only `sources` are judged; the other loaded files stay in the merged
   * lcov for SonarCloud but are not held to the gate.
   */
  only?: boolean;
}

export interface GateResult {
  /** Empty only when every shard is in and every loaded file and source is at the gate. */
  problems: string[];
  /** The shards' Bun lcov merged, for SonarCloud; empty when a shard is missing. */
  lcov: string;
  /** True when a shard is missing, failed or partial: the problems are about the run, not coverage. */
  closed: boolean;
  /** The sources at the gate (80% of lines and functions) from the collected shards, sorted. */
  covered: string[];
}

interface BunFile {
  hits: Map<number, number>;
  /** [called, found], as Bun counts them. */
  functions: [number, number];
}

/** A shard's lcov, by file: the hits of each executable line and the function counts. */
function readLcov(text: string): Map<string, BunFile> {
  const files = new Map<string, BunFile>();
  let current: BunFile | null = null;
  for (const line of text.split(/\r?\n/)) {
    const [key, value = ""] = line.split(":", 2) as [string, string?];
    if (key === "SF") {
      current = { hits: new Map(), functions: [0, 0] };
      files.set(line.slice(3).replaceAll("\\", "/"), current);
    } else if (current && key === "FNH") current.functions[0] = Number(value);
    else if (current && key === "FNF") current.functions[1] = Number(value);
    else if (current && key === "DA") {
      const [at = "", hits = ""] = value.split(",");
      current.hits.set(Number(at), Number(hits));
    }
  }
  return files;
}

interface Shard {
  lcov: Map<string, BunFile>;
  functions: Record<string, FunctionCoverage>;
}

/** The one job of each shard and kind, or the problems that leave the gate with no verdict. */
function collect(input: GateInput): { shards: Shard[]; problems: string[] } {
  const problems: string[] = [];
  const n = input.shards;
  for (const job of input.jobs) {
    if (!job.marker) problems.push("a shard job left a report with no marker");
    else if (job.marker.of !== n || job.marker.shard < 1 || job.marker.shard > n) {
      problems.push(
        `shard ${job.marker.shard}/${job.marker.of} ${job.marker.kind}: not one of the ${n} shards`,
      );
    }
  }
  const pick = (shard: number, kind: ShardMarker["kind"]) => {
    const found = input.jobs.filter(
      (job) => job.marker?.of === n && job.marker.shard === shard && job.marker.kind === kind,
    );
    const name = `shard ${shard}/${n} ${kind}`;
    const job = found[0];
    if (!job?.marker) problems.push(`${name}: missing`);
    else if (found.length > 1) problems.push(`${name}: doubled`);
    else if (job.data === null) problems.push(`${name}: no report`);
    else if (job.marker.exit !== 0 || job.marker.fail > 0) {
      problems.push(
        `${name}: its tests failed (exit ${job.marker.exit}, ${job.marker.fail} failed)`,
      );
    }
    return job;
  };
  const range = input.shardsOf ?? Array.from({ length: n }, (_, k) => k + 1);
  const bunJobs = range.map((i) => pick(i, "bun"));
  const istanbulJobs = range.map((i) => pick(i, "istanbul"));
  const shards: Shard[] = [];
  const ran: string[] = [];
  for (const i of range) {
    const b = bunJobs[i - 1];
    const s = istanbulJobs[i - 1];
    ran.push(...(b?.marker?.files ?? []));
    const same = (a: string[] = [], z: string[] = []) =>
      a.length === z.length && a.every((f) => z.includes(f)) && z.every((f) => a.includes(f));
    if (b?.marker && s?.marker && !same(b.marker.files, s.marker.files)) {
      problems.push(`shard ${i}/${n}: the bun and istanbul jobs ran different test files`);
    }
    let functions: Record<string, FunctionCoverage> = {};
    try {
      functions = JSON.parse(s?.data ?? "{}") as Record<string, FunctionCoverage>;
    } catch {
      problems.push(`shard ${i}/${n} istanbul: its report does not parse`);
    }
    shards.push({ lcov: readLcov(b?.data ?? ""), functions });
  }
  const missing = input.tests.filter((t) => !ran.includes(t));
  if (missing.length > 0) {
    const more = missing.length > 10 ? ` and ${missing.length - 10} more` : "";
    problems.push(
      `${missing.length} test file(s) ran in no shard: ${missing.slice(0, 10).join(", ")}${more}`,
    );
  }
  const twice = [...new Set(ran.filter((t, k) => ran.indexOf(t) !== k))];
  if (twice.length > 0) {
    problems.push(`${twice.length} test file(s) ran in more than one shard: ${twice.join(", ")}`);
  }
  return { shards, problems };
}

/** One file's function coverage from the shards: istanbul's maps, else Bun's counts; null when unsettled. */
function functionsOf(
  path: string,
  parts: BunFile[],
  shards: Shard[],
  problems: string[],
): [number, number] | null {
  const maps = shards.flatMap((s) => s.functions[path] ?? []);
  const first = maps[0];
  if (first) {
    const ids = Object.keys(first.fnMap);
    // Each function by id, name and line: the same count of other functions is not the same file.
    const shape = (m: FunctionCoverage) =>
      Object.entries(m.fnMap)
        .map(([id, fn]) => `${id}:${fn.name}:${fn.line}`)
        .join();
    if (maps.some((m) => shape(m) !== shape(first))) {
      problems.push(`${path}: the shards disagree on its functions; run the suite whole`);
      return null;
    }
    const called = ids.filter((id) => maps.some((m) => (m.f[id] ?? 0) > 0)).length;
    return [called, ids.length];
  }
  const found = parts[0]?.functions[1] ?? 0;
  const hits = parts.map((p) => p.functions[0]);
  if (hits.some((hit) => hit >= found)) return [found, found];
  // Each shard calls a subset; when their sizes cannot reach the total, some function never ran.
  if (hits.reduce((total, hit) => total + hit, 0) < found) return [Math.max(...hits), found];
  // The best shard alone reaches the gate: whatever the others ran, the file passes (#1011 review).
  if (!belowGate([Math.max(...hits), found])) return [Math.max(...hits), found];
  problems.push(
    `${path}: the shards' function counts cannot tell whether every function ran; run the suite whole`,
  );
  return null;
}

/** The merged verdict and lcov, or the problems that leave the gate closed. */
export function shardGate(input: GateInput): GateResult {
  const { shards, problems: closed } = collect(input);
  if (closed.length > 0) return { problems: closed, lcov: "", closed: true, covered: [] };
  const paths = [...new Set(shards.flatMap((s) => [...s.lcov.keys()]))];
  const problems: string[] = [];
  const report = new Map<string, FileCoverage>();
  const records: string[] = [];
  for (const path of paths) {
    const parts = shards.flatMap((s) => s.lcov.get(path) ?? []);
    const hits = new Map<number, number>();
    const lines = [...(parts[0]?.hits.keys() ?? [])].sort((a, b) => a - b).join();
    if (parts.some((p) => [...p.hits.keys()].sort((a, b) => a - b).join() !== lines)) {
      problems.push(`${path}: the shards disagree on its lines; run the suite whole`);
      continue;
    }
    for (const part of parts) {
      for (const [at, n] of part.hits) hits.set(at, Math.max(hits.get(at) ?? 0, n));
    }
    const functions = functionsOf(path, parts, shards, problems);
    if (!functions) continue;
    const covered = [...hits.values()].filter((n) => n > 0).length;
    report.set(path, { functions, lines: [covered, hits.size] });
    records.push(
      [
        `SF:${path}`,
        // The merged counts of the file (the istanbul maps' union): each shard's own Bun count is of
        // what that shard loaded, so their max could pass the first one's total (#2019).
        `FNF:${functions[1]}`,
        `FNH:${functions[0]}`,
        ...[...hits].sort(([a], [b]) => a - b).map(([at, n]) => `DA:${at},${n}`),
        `LF:${hits.size}`,
        `LH:${covered}`,
        "end_of_record",
      ].join("\n"),
    );
  }
  // A PR judges its changed sources only; every other loaded file stays in the lcov (#1761).
  const judged = input.only ? new Set(input.sources) : null;
  const ownProblems = judged
    ? problems.filter((p) => judged.has(p.slice(0, p.indexOf(":"))))
    : problems;
  const unsettled = new Set(problems.map((p) => p.slice(0, p.indexOf(":"))));
  const checked = [...new Set([...input.sources, ...(judged ? [] : report.keys())])].filter(
    (p) => !unsettled.has(p),
  );
  const all = [...ownProblems, ...checkCoverage(report, checked)].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const covered = input.sources
    .filter((path) => {
      const file = report.get(path);
      return file !== undefined && !belowGate(file.functions) && !belowGate(file.lines);
    })
    .sort((a, b) => a.localeCompare(b, "en"));
  return { problems: all, lcov: records.map((r) => `${r}\n`).join(""), closed: false, covered };
}

/** How one shard job runs: the bun job writes an lcov into `out`, the istanbul job its counters. */
export interface ShardRun {
  argv: string[];
  env: Record<string, string>;
  /** The istanbul job's files, as JSON: written to `path` before the run, whose env names it. */
  targetsFile?: { path: string; text: string };
}

export function shardRun(
  kind: ShardMarker["kind"],
  files: readonly string[],
  out: string,
  targets: readonly string[],
): ShardRun {
  const tests = testArgs(
    "linux",
    files.map((file) => `./${file}`),
    // The bun job keeps each test's time with its report (#1003); istanbul's times are skewed.
    kind === "bun" ? `${out}/junit.xml` : undefined,
  );
  if (kind === "bun") {
    const [sub = "test", timeout = "", ...rest] = tests;
    return {
      argv: ["bun", "--config=bunfig.related.toml", sub, timeout, `--coverage-dir=${out}`, ...rest],
      env: {},
    };
  }
  return {
    argv: ["bun", "--config=bunfig.shard.toml", ...tests],
    env: { COVERAGE_FUNCS_FILES: JSON.stringify(targets), COVERAGE_FUNCS_OUT: `${out}/funcs.json` },
  };
}

/** The files the istanbul job instruments: every tracked source the full suite's gate counts. */
export function istanbulTargets(tracked: readonly string[]): string[] {
  return tracked.filter(
    (path) =>
      /\.tsx?$/.test(path) &&
      !path.endsWith(".d.ts") &&
      !TEST_FILE.test(path) &&
      !WHOLE_SUITE_IGNORED.test(path),
  );
}

/** The failed tests a bun test log reports. */
export function failedCount(log: string): number {
  return Number(/^\s*(\d+) fail$/m.exec(log)?.[1] ?? 0); // NOSONAR: a bun test log of the run, read by a CI gate
}

/**
 * The real `spawn` of the shard and istanbul-changed scripts: runs argv in `cwd` with `env` over
 * the process's own, and gives its exit code and its stdout then stderr as one log.
 */
export function spawnLogged(
  cwd: string,
): (argv: string[], env: Record<string, string>) => Promise<{ exit: number; log: string }> {
  return async (argv, env) => {
    const proc = Bun.spawn(argv, {
      cwd,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    }); // NOSONAR: bun and git come from the PATH of the developer or the CI runner running the script
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exit: await proc.exited, log: `${stdout}${stderr}` };
  };
}

/** A PR's selection (#1761): the test files its shards split, and the changed sources they must cover. */
export interface Selection {
  tests: readonly string[];
  targets: readonly string[];
}

/**
 * The selection of `test:related --pr`'s plan, or null when the whole suite runs (a global file
 * changed or a test went away), or the plan's own problem when it cannot run (#1761).
 */
export function selectionOf(plan: {
  code: number;
  output: string;
  command: string[] | null;
  files?: string[] | "all";
  targets?: string[];
}): Selection | null | { problem: string } {
  if (plan.files === "all") return null;
  if (plan.command === null && plan.code !== 0) return { problem: plan.output };
  return { tests: plan.files ?? [], targets: plan.targets ?? [] };
}

/** What `runShard` touches: the checkout, its tracked files and timings, and the effects. */
export interface RunShardDeps {
  root: string;
  tracked: readonly string[];
  timings: Timings;
  mkdir: (path: string) => void;
  write: (path: string, text: string) => void;
  spawn: (argv: string[], env: Record<string, string>) => Promise<{ exit: number; log: string }>;
  print: (line: string) => void;
  /** A PR's selection instead of the whole suite (#1761). */
  selection?: Selection;
  /** A test file's tier (#261): given, the shards are the tier plan's (#1854). */
  tierOf?: (path: string) => Tier | undefined;
  /** The clock, in milliseconds. */
  now?: () => number;
  /** Sources a PR's unit + component shards instrument besides the changed ones: the fast baseline (#1854). */
  extraTargets?: readonly string[];
}

/** `run <i>/<n> <bun|istanbul> <out>`: one shard job, its log and its marker; the exit code. */
export async function runShard(
  spec: string,
  kind: string,
  out: string,
  deps: RunShardDeps,
): Promise<number> {
  const usage = "usage: bun run scripts/shard-gate.ts run <i>/<n> <bun|istanbul> <out>";
  const parsed = /^(\d+)\/(\d+)$/.exec(spec);
  const index = Number(parsed?.[1]);
  const count = Number(parsed?.[2]);
  if (!parsed || index < 1 || index > count || (kind !== "bun" && kind !== "istanbul")) {
    deps.print(usage);
    return 2;
  }
  // The istanbul preload writes its counters after each test file, and the repo guard fails a run
  // that leaves a file in the checkout.
  const inside = relative(deps.root, resolve(out));
  if (!inside.startsWith("..") && !isAbsolute(inside)) {
    deps.print(`shard-gate: write the shard's output outside the checkout, not in ${out}`);
    return 2;
  }
  const { selection, tierOf } = deps;
  const all = selection ? [...selection.tests] : testFiles([...deps.tracked]);
  // With a tier map (#1854) the shards are the tier plan's: this one runs its group's tiers only.
  const at = tierOf ? tierShard(index, count) : null;
  if (tierOf && !at) {
    deps.print(`shard-gate: ${spec} is not a shard of the tier plan (${TIER_SHARDS} shards)`);
    return 2;
  }
  const files =
    at && tierOf
      ? (tierShardFiles(all, tierOf, deps.timings, index, count)?.files ?? [])
      : (splitShards(all, deps.timings, count)[index - 1] ?? []);
  const tier = at ? { tier: `${at.group.label} ${at.part}/${at.of}` } : {};
  // A bun test with no file runs the whole suite. A PR's small selection can leave a shard empty:
  // it passes with empty reports, so the merge still sees every shard (#1761).
  if (files.length === 0 && selection) {
    deps.mkdir(out);
    const marker: ShardMarker = { shard: index, of: count, kind, files, exit: 0, fail: 0, ...tier };
    deps.write(join(out, "marker.json"), JSON.stringify(marker));
    deps.write(join(out, kind === "bun" ? "lcov.info" : "funcs.json"), kind === "bun" ? "" : "{}");
    deps.print(`shard ${index}/${count} ${kind}: no test file in this PR's selection`);
    return 0;
  }
  if (files.length === 0) {
    deps.print(`shard-gate: shard ${index}/${count} has no test files`);
    return 2;
  }
  deps.mkdir(out);
  // The fast baseline is judged from these shards: instrumented, never left to Bun's per-shard counts.
  const extra = FAST_SHARDS.includes(index) ? (deps.extraTargets ?? []) : [];
  const targets = selection
    ? [...new Set([...selection.targets, ...extra])]
    : istanbulTargets(deps.tracked);
  const plan = shardRun(kind, files, out, targets);
  const started = deps.now?.();
  const { exit, log } = await deps.spawn(plan.argv, plan.env);
  const ended = deps.now?.();
  deps.write(join(out, "test.log"), log);
  const marker: ShardMarker = {
    shard: index,
    of: count,
    kind,
    files,
    exit,
    fail: failedCount(log),
    ...tier,
    ...(started !== undefined && ended !== undefined ? { seconds: (ended - started) / 1000 } : {}),
  };
  deps.write(join(out, "marker.json"), JSON.stringify(marker));
  for (const line of log.split("\n").filter((l) => /^\s*\d+ (pass|fail|skip)$|^Ran /.test(l))) {
    deps.print(line);
  }
  deps.print(`shard ${index}/${count} ${kind}: ${files.length} test file(s), exit ${exit}`);
  return exit;
}

/** What `mergeShards` touches: the artifact folders, the tracked files, the sources, the output. */
export interface MergeShardsDeps {
  /** The folder names under `dir`; none when it does not exist. */
  folders: (dir: string) => string[];
  /** A file's text, or null when it does not exist. */
  read: (path: string) => string | null;
  /** Writes a file, making its folder. */
  write: (path: string, text: string) => void;
  tracked: readonly string[];
  sources: readonly string[];
  print: (line: string) => void;
  error: (line: string) => void;
  /** A PR's selection instead of the whole suite (#1761). */
  selection?: Selection;
  /** The tier of every test file (#261): given with `pyramid`, the run's pyramid table is built. */
  tiers?: Record<string, Tier>;
  /** Where each file ran on the shards, when it differs from `tiers` (a UI test with a daemon). */
  shardTiers?: Record<string, Tier>;
  /** Gets the pyramid table as markdown and as JSON (#1854). */
  pyramid?: (markdown: string, json: string) => void;
  /** The sources the fast tiers covered at the gate before (fast-coverage-baseline.json). */
  fastBaseline?: readonly string[];
  /** Gets the fast-coverage ratchet's verdict, from the unit + component shards alone (#1854). */
  fastResult?: (result: { ok: boolean; lines: string[] }) => void;
}

/**
 * The fast-coverage ratchet (#309) from the unit + component shards alone (#1854): the sources they
 * cover at the gate must still include every one in the baseline. The base of the pyramid already
 * ran, with its own coverage, so it is not run a third time for a report.
 */
function fastCoverageOf(
  count: number,
  jobs: readonly ShardJob[],
  deps: MergeShardsDeps,
  tiers: Record<string, Tier>,
  baseline: readonly string[],
): { ok: boolean; lines: string[] } {
  const base = TIER_GROUPS[0]?.tiers ?? [];
  const tests = (deps.selection ? [...deps.selection.tests] : testFiles([...deps.tracked])).filter(
    (test) => base.includes(tiers[test] ?? "unit"),
  );
  const fast = shardGate({
    shards: count,
    shardsOf: FAST_SHARDS,
    tests,
    jobs,
    sources: deps.sources,
  });
  if (fast.closed) {
    return {
      ok: false,
      lines: [
        `fast-coverage: the unit + component shards give no verdict (${fast.problems.length} problem(s)):`,
        ...fast.problems.map((p) => `  - ${p}`),
      ],
    };
  }
  const { dropped } = fastCoverageVerdict(fast.covered, baseline, deps.sources);
  if (dropped.length > 0) {
    return {
      ok: false,
      lines: [
        `fast-coverage: ${dropped.length} source(s) the fast tiers covered at the gate no longer are:`,
        ...dropped.map((path) => `  - ${path}`),
        "Cover them again with unit or component tests (the base of the pyramid only grows).",
      ],
    };
  }
  return {
    ok: true,
    lines: [
      `fast-coverage: ${fast.covered.length} of ${deps.sources.length} source(s) at the gate from the fast tiers; the ${baseline.length} listed hold`,
    ],
  };
}

/** `merge <dir> <n> <lcov>`: the merged gate over each job's folder; the exit code. */
export function mergeShards(
  dir: string,
  count: number,
  lcovOut: string,
  deps: MergeShardsDeps,
): number {
  const junits: Array<{ marker: ShardMarker | null; junit: string | null }> = [];
  const jobs: ShardJob[] = deps.folders(dir).map((name) => {
    const at = join(dir, name);
    let marker: ShardMarker | null = null;
    try {
      marker = JSON.parse(deps.read(join(at, "marker.json")) ?? "null") as ShardMarker | null;
    } catch {
      // A torn marker (a job killed while writing it) counts as none: the gate names it.
    }
    // The istanbul job leaves its counters, the bun job its lcov; a folder with no marker still counts.
    const lcov = deps.read(join(at, "lcov.info"));
    const funcs = deps.read(join(at, "funcs.json"));
    junits.push({ marker, junit: deps.read(join(at, "junit.xml")) });
    if (!marker) return { marker: null, data: lcov ?? funcs };
    return { marker, data: marker.kind === "istanbul" ? funcs : lcov };
  });
  // The pyramid first: a run with no verdict still shows how long each tier took (#1854).
  if (deps.tiers && deps.pyramid) {
    const table = pyramidOf(deps.tiers, junits);
    deps.pyramid(renderPyramid(table), JSON.stringify(table, null, 2));
  }
  const result = shardGate({
    shards: count,
    tests: deps.selection ? deps.selection.tests : testFiles([...deps.tracked]),
    jobs,
    sources: deps.selection ? deps.selection.targets : deps.sources,
    ...(deps.selection ? { only: true } : {}),
  });
  if (result.lcov) deps.write(lcovOut, result.lcov);
  if (deps.tiers && deps.fastBaseline && deps.fastResult) {
    deps.fastResult(
      fastCoverageOf(count, jobs, deps, deps.shardTiers ?? deps.tiers, deps.fastBaseline),
    );
  }
  if (result.problems.length === 0) {
    deps.print(
      `cobertura de ${COVERAGE_GATE}% ou mais em ${(deps.selection ? deps.selection.targets : deps.sources).length} arquivos-fonte, de ${count} shards`,
    );
    return 0;
  }
  deps.error(
    result.closed
      ? `the sharded run has no coverage verdict (${result.problems.length} problem(s)):`
      : `cobertura abaixo de ${COVERAGE_GATE}% em ${result.problems.length} arquivo(s):`,
  );
  for (const problem of result.problems) deps.error(`  - ${problem}`);
  return 1;
}
