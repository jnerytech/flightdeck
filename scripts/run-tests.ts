// `bun run test`: the whole suite with the platform's timeout, then the coverage check (80% per file, #1002).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localPyramid } from "./lib/tests/pyramid-table.ts";
import { testTiers } from "./lib/tests/test-tiers.ts";
import { testArgs } from "./test/timeout.ts";

const ROOT = resolve(import.meta.dir, "..");
const run = async (args: string[]) =>
  await Bun.spawn([process.execPath, ...args], { stdio: ["inherit", "inherit", "inherit"] }).exited;

// CI sets FLIGHTDECK_JUNIT to keep each test's time for the slow-test check (#1003); a local run
// keeps it in a temporary folder for the per-tier table it ends with (#1854).
const scratch = process.env.FLIGHTDECK_JUNIT ? null : mkdtempSync(join(tmpdir(), "run-tests-"));
const junit = process.env.FLIGHTDECK_JUNIT ?? join(scratch ?? "", "junit.xml");
const code = await run(testArgs(process.platform, Bun.argv.slice(2), junit));
try {
  const listed = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" }); // NOSONAR: git comes from the PATH of the developer running the script
  const paths = listed.stdout.split("\n").filter(Boolean);
  const tiers = testTiers(new Map(paths.map((p) => [p, readFileSync(resolve(ROOT, p), "utf8")])));
  const table = localPyramid(tiers, readFileSync(junit, "utf8"));
  if (table) console.log(`\n${table}`);
} catch {
  // A run that wrote no report prints no table.
}
if (scratch) rmSync(scratch, { recursive: true, force: true });
process.exit(code === 0 ? await run(["run", "scripts/check-coverage.ts"]) : code);
