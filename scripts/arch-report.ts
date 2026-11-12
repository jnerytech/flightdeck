#!/usr/bin/env bun
/**
 * `bun run scripts/arch-report.ts [--json <file>]`: the table of every structure ratchet, each
 * baseline against today's count (issue #1610). It prints the table, appends it to the CI job
 * summary when GITHUB_STEP_SUMMARY is set, writes the rows as JSON with `--json`, and exits 1 when
 * any figure is above its baseline (it runs knip, about 7 s, for the dead-code rows). The logic is scripts/lib/arch-report.ts.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG, KNOWN, ruleNames } from "./lib/arch-ratchet.ts";
import { formatTable, growing, ratchetRows, shapeShares } from "./lib/arch-report.ts";
import { isScanned, rawJsonParseCounts } from "./lib/json-parse.ts";
import { knipCounts } from "./lib/knip-counts.ts";
import { isMeasured, oversizedSources } from "./lib/src-size.ts";
import { flatTestCounts } from "./lib/test-layout.ts";
import { testTiers } from "./lib/test-tiers.ts";

const ROOT = resolve(import.meta.dir, "..");
const git = (args: string[]): string | null => {
  const proc = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); // NOSONAR: git from the PATH of the developer or the CI runner
  return proc.status === 0 ? proc.stdout : null;
};
const read = (path: string): string | null => {
  try {
    return readFileSync(resolve(ROOT, path), "utf8");
  } catch {
    return null;
  }
};
const json = (path: string): Record<string, number> => JSON.parse(read(path) ?? "{}");

/** knip's JSON report; it exits 1 whenever it finds anything, so the exit code says nothing. */
function runKnip(): string {
  const proc = spawnSync(process.execPath, ["x", "knip", "--reporter", "json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }); // NOSONAR: bun itself, fixed arguments
  if (proc.error || proc.signal)
    throw new Error(`knip did not run: ${proc.error?.message ?? `killed by ${proc.signal}`}`);
  if (!proc.stdout) throw new Error(`knip printed no report: ${proc.stderr.slice(0, 500)}`);
  return proc.stdout;
}

const mergeBase = ["origin/main", "main"]
  .map((main) => git(["merge-base", "HEAD", main])?.trim())
  .find((found) => found);
const tracked = (git(["ls-files", "apps", "packages", "scripts"]) ?? "")
  .split("\n")
  .filter(Boolean);
// every tracked TypeScript source file under a package's src; one deleted in the working copy is skipped
const sources = tracked
  .filter((path) => isScanned(path) || isMeasured(path))
  .flatMap((path) => {
    const text = read(path);
    return text === null ? [] : [{ path, text }];
  });
// The tier of each test file is computed from its content (#261); the shape counts files per tier.
// Every tracked TypeScript file, as `bun run test:tiers` reads them, so the two agree.
const allTs = (git(["ls-files", "*.ts", "*.tsx"]) ?? "")
  .split("\n")
  .filter(Boolean)
  .flatMap((path) => {
    const text = read(path);
    return text === null ? [] : [[path, text] as const];
  });
const filesByTier: Record<string, number> = {};
for (const tier of Object.values(testTiers(new Map(allTs))))
  filesByTier[tier] = (filesByTier[tier] ?? 0) + 1;
const rows = ratchetRows({
  knownBase: mergeBase ? git(["show", `${mergeBase}:${KNOWN}`]) : null,
  knownHead: read(KNOWN),
  baseRules: ruleNames(mergeBase ? git(["show", `${mergeBase}:${CONFIG}`]) : null),
  srcOversized: oversizedSources(sources.filter(({ path }) => isMeasured(path))),
  srcBaseline: json("src-size-baseline.json"),
  flatCounts: flatTestCounts(tracked),
  flatBaseline: json("test-layout-baseline.json"),
  knipCounts: knipCounts(runKnip()),
  knipBaseline: json("knip-baseline.json"),
  jsonParseCounts: rawJsonParseCounts(sources),
  jsonParseBaseline: json("json-parse-baseline.json"),
  shapeShares: shapeShares(filesByTier),
  shapeBaseline: json("test-shape-baseline.json"),
});
const table = formatTable(rows);
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Structure ratchets\n\n${table}\n`);
const jsonAt = process.argv.indexOf("--json");
const out = jsonAt >= 0 ? process.argv[jsonAt + 1] : undefined;
if (jsonAt >= 0 && (!out || out.startsWith("--"))) {
  console.error("arch-report: --json needs a file path");
  process.exit(2);
}
if (out) writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
const up = growing(rows);
if (up.length > 0) {
  console.error(`arch-report: ${up.map((r) => r.ratchet).join(", ")} above the baseline (#1610)`);
  process.exit(1);
}
