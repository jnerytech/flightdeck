#!/usr/bin/env bun
/**
 * The sharded whole-suite run (#296); the logic is in lib/shard-gate.ts, this wires the effects.
 * - `run <i>/<n> <bun|istanbul> <out>`: runs shard i of n, split as `test:shards` splits it, and
 *   writes `marker.json` next to the lcov (bun) or the function counters (istanbul).
 * - `merge <dir> <n> <lcov>`: reads each job's folder under <dir>, runs the merged 100% gate, and
 *   writes the merged lcov for SonarCloud. It fails closed when a shard is missing or failed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hasRuntimeCode, isCoverageSource } from "./lib/coverage-check.ts";
import {
  failedCount,
  istanbulTargets,
  type ShardJob,
  type ShardMarker,
  shardGate,
  shardRun,
} from "./lib/shard-gate.ts";
import { splitShards, type Timings, testFiles } from "./lib/test-shards.ts";

const ROOT = resolve(import.meta.dir, "..");
const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }) // NOSONAR: git comes from the PATH of the developer or the CI runner running the script
  .stdout.toString()
  .split("\n")
  .filter(Boolean);
const tests = testFiles(tracked);
const readIf = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

async function run(spec: string, kind: string, out: string): Promise<number> {
  const [index, count] = spec.split("/").map(Number);
  if (!index || !count || (kind !== "bun" && kind !== "istanbul")) {
    console.error("usage: bun run scripts/shard-gate.ts run <i>/<n> <bun|istanbul> <out>");
    return 2;
  }
  const timings = JSON.parse(
    readFileSync(join(ROOT, "scripts/test-timings.json"), "utf8"),
  ) as Timings;
  const files = splitShards(tests, timings, count)[index - 1] ?? [];
  mkdirSync(out, { recursive: true });
  const plan = shardRun(kind, files, out, istanbulTargets(tracked));
  const proc = Bun.spawn(plan.argv, {
    cwd: ROOT,
    env: { ...process.env, ...plan.env },
    stdout: "pipe",
    stderr: "pipe",
  }); // NOSONAR: bun comes from the PATH of the developer or the CI runner running the script
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  const log = `${stdout}${stderr}`;
  writeFileSync(join(out, "test.log"), log);
  const marker: ShardMarker = {
    shard: index,
    of: count,
    kind,
    files,
    exit,
    fail: failedCount(log),
  };
  writeFileSync(join(out, "marker.json"), JSON.stringify(marker));
  console.log(
    log
      .split("\n")
      .filter((l) => /^\s*\d+ (pass|fail|skip)$|^Ran /.test(l))
      .join("\n"),
  );
  console.log(`shard ${index}/${count} ${kind}: ${files.length} test file(s), exit ${exit}`);
  return exit;
}

function merge(dir: string, count: number, lcovOut: string): number {
  const jobs: ShardJob[] = (existsSync(dir) ? readdirSync(dir) : []).map((name) => {
    const at = join(dir, name);
    const marker = readIf(join(at, "marker.json"));
    const parsed = marker ? (JSON.parse(marker) as ShardMarker) : null;
    // The istanbul job leaves its counters, the bun job its lcov; a folder with no marker still counts.
    const lcov = readIf(join(at, "lcov.info"));
    const funcs = readIf(join(at, "funcs.json"));
    if (!parsed) return { marker: null, data: lcov ?? funcs };
    return { marker: parsed, data: parsed.kind === "istanbul" ? funcs : lcov };
  });
  const sources = tracked
    .filter(isCoverageSource)
    .filter((path) =>
      hasRuntimeCode(readFileSync(join(ROOT, path), "utf8"), path.endsWith(".tsx") ? "tsx" : "ts"),
    );
  const result = shardGate({ shards: count, tests, jobs, sources });
  if (result.lcov) {
    mkdirSync(resolve(lcovOut, ".."), { recursive: true });
    writeFileSync(lcovOut, result.lcov);
  }
  if (result.problems.length > 0) {
    console.error(`cobertura abaixo de 100% em ${result.problems.length} arquivo(s):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(`cobertura 100% em ${sources.length} arquivos-fonte, de ${count} shards`);
  return 0;
}

const [command, a = "", b = "", c = ""] = process.argv.slice(2).filter((arg) => arg !== "--");
if (command === "run") process.exit(await run(a, b, c));
else if (command === "merge") process.exit(merge(a, Number(b), c));
else {
  console.error(
    "usage: bun run scripts/shard-gate.ts run <i>/<n> <bun|istanbul> <out> | merge <dir> <n> <lcov>",
  );
  process.exit(2);
}
