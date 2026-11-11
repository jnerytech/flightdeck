#!/usr/bin/env bun
/**
 * The sharded whole-suite run (#296); the logic is in lib/shard-gate.ts (`runShard`, `mergeShards`),
 * this wires the real effects.
 * - `run <i>/<n> <bun|istanbul> <out>`: runs shard i of n, split as `test:shards` splits it, and
 *   writes `marker.json` next to the lcov (bun) or the function counters (istanbul). <out> is
 *   outside the checkout: the repo guard fails a test run that leaves a file in it.
 * - `... --base <ref>` (#1761): a PR's or a push's selection (`test:related --pr`'s plan) instead of the
 *   whole suite, with the gate on its changed sources only.
 * - `merge <dir> <n> <lcov>`: reads each job's folder under <dir>, runs the merged coverage gate (80%), and
 *   writes the merged lcov for SonarCloud. It fails closed when a shard is missing or failed.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hasRuntimeCode, isCoverageSource } from "./lib/coverage-check.ts";
import {
  mergeShards,
  runShard,
  type Selection,
  selectionOf,
  spawnLogged,
} from "./lib/shard-gate.ts";
import { planRelated } from "./lib/test-related.ts";
import type { Timings } from "./lib/test-shards.ts";
import { shardTiers, testTiers } from "./lib/test-tiers.ts";

const ROOT = resolve(import.meta.dir, "..");
const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }) // NOSONAR: git comes from the PATH of the developer or the CI runner running the script
  .stdout.toString()
  .split("\n")
  .filter(Boolean);
const readIf = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const baseAt = argv.indexOf("--base");
const base = baseAt >= 0 ? argv[baseAt + 1] : undefined;
// A `--base` with no ref is a mistake, never a silent run of the whole suite (#1761 review).
if (baseAt >= 0 && !base) {
  console.error("shard-gate: --base needs a ref");
  process.exit(2);
}
const [command, a = "", b = "", c = ""] = argv.filter(
  (_, i) => baseAt < 0 || (i !== baseAt && i !== baseAt + 1),
);

/** The tier of every test file (#261), by path: the shards run the tier plan's groups (#1854). */
const sourcesOfTests = new Map(
  tracked.filter((p) => /\.tsx?$/.test(p)).map((p) => [p, readFileSync(join(ROOT, p), "utf8")]),
);
const tiers = testTiers(sourcesOfTests);
/** Where each file runs: a UI test that also starts a daemon runs on the component shards (#1854). */
const shardTierOf = shardTiers(sourcesOfTests);

/** The PR's selection (#1761): null for the whole suite; exits when the plan cannot run. */
function selectionFor(ref: string | undefined): Selection | undefined {
  if (ref === undefined) return undefined;
  const plan = planRelated({
    base: ref,
    platform: process.platform,
    git: (args) => {
      const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT }); // NOSONAR: git comes from the PATH of the developer or the CI runner running the script
      return proc.exitCode === 0 ? proc.stdout.toString() : null;
    },
    readFile: (path) => readFileSync(join(ROOT, path), "utf8"),
    // Asking for coverage makes the plan name the changed sources the shards must cover.
    coverageDir: "coverage",
    pyramid: true,
    slot: false,
    tierOf: (path) => tiers[path],
  });
  console.log(plan.output);
  const picked = selectionOf(plan);
  if (picked && "problem" in picked) process.exit(2);
  return picked ?? undefined;
}

if (command === "run") {
  const selection = selectionFor(base);
  process.exit(
    await runShard(a, b, c, {
      root: ROOT,
      tracked,
      timings: JSON.parse(readFileSync(join(ROOT, "scripts/test-timings.json"), "utf8")) as Timings,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      write,
      spawn: spawnLogged(ROOT),
      print: (line) => console.log(line),
      tierOf: (path) => shardTierOf[path],
      now: Date.now,
      extraTargets: JSON.parse(readFileSync(join(ROOT, "fast-coverage-baseline.json"), "utf8")),
      ...(selection ? { selection } : {}),
    }),
  );
} else if (command === "merge") {
  const selection = selectionFor(base);
  const sources = tracked
    .filter(isCoverageSource)
    .filter((path) =>
      hasRuntimeCode(readFileSync(join(ROOT, path), "utf8"), path.endsWith(".tsx") ? "tsx" : "ts"),
    );
  process.exit(
    mergeShards(a, Number(b), c, {
      folders: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
      read: readIf,
      write,
      tracked,
      sources,
      print: (line) => console.log(line),
      error: (line) => console.error(line),
      tiers,
      shardTiers: shardTierOf,
      // The pyramid (#1854): in the log, in the job summary when GitHub gives one, and as JSON next
      // to the lcov, for the artifact a trend is charted from.
      pyramid: (markdown, json) => {
        console.log(markdown);
        if (process.env.GITHUB_STEP_SUMMARY)
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
        write(join(dirname(c), "pyramid.json"), json);
      },
      // The fast-coverage ratchet (#309) reads the unit + component shards: the job of that name
      // only reads this verdict from the suite's output (#1854).
      fastBaseline: JSON.parse(readFileSync(join(ROOT, "fast-coverage-baseline.json"), "utf8")),
      fastResult: ({ ok, lines }) => {
        for (const line of lines) (ok ? console.log : console.error)(line);
        if (process.env.GITHUB_OUTPUT) {
          appendFileSync(process.env.GITHUB_OUTPUT, `fast=${ok ? "pass" : "fail"}\n`);
        }
      },
      ...(selection ? { selection } : {}),
    }),
  );
} else {
  console.error(
    "usage: bun run scripts/shard-gate.ts run <i>/<n> <bun|istanbul> <out> [--base <ref>] | merge <dir> <n> <lcov> [--base <ref>]",
  );
  process.exit(2);
}
