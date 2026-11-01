/**
 * `bun run perf:baseline [--out <dir>]` prints the phase 28 baseline for this machine as a
 * Markdown table; with `--out` it also writes `perf-baseline.md` and `perf-baseline.json` there
 * (the CI job uploads them as an artifact). It never fails on a missing measure: a step that
 * cannot run says why in its row, so the CI step is not a gate.
 *
 * Build the app first (`bun run build:desktop`) for question 1.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  bundleChunks,
  bundleMeasures,
  entryFile,
  eventStoreMeasures,
  formatReport,
  type Machine,
  machineTag,
  runSteps,
} from "./lib/perf-baseline.ts";

const DIST = resolve(import.meta.dir, "../apps/desktop/dist");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;

const machine: Machine = {
  tag: machineTag(process.env, process.platform, process.arch),
  os: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model ?? "unknown",
  cores: cpus().length,
  load1: Math.round((loadavg()[0] ?? 0) * 100) / 100,
  bun: Bun.version,
  date: new Date().toISOString().slice(0, 10),
};

const measures = runSteps([
  {
    question: 1,
    name: "bundle",
    run: () =>
      bundleMeasures(bundleChunks(DIST), entryFile(readFileSync(join(DIST, "index.html"), "utf8"))),
  },
  {
    question: 9,
    name: "persisted events",
    run: () => {
      const dir = mkdtempSync(join(tmpdir(), "fd-perf-"));
      return [...eventStoreMeasures(dir, "FULL", 1000), ...eventStoreMeasures(dir, "NORMAL", 1000)];
    },
  },
]);

const report = formatReport(machine, measures);
console.log(report);
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "perf-baseline.md"), report);
  writeFileSync(
    join(out, "perf-baseline.json"),
    `${JSON.stringify({ machine, measures }, null, 2)}\n`,
  );
}
