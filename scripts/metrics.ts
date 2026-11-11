#!/usr/bin/env bun
/**
 * `bun run metrics -- --tag <vX.Y.Z> --out <file>` (issue #1949): writes the engineering metrics
 * snapshot of the repository at a tag as JSON. The logic is in lib/metrics/; this reads git and the
 * ratchet report (scripts/arch-report.ts --json, whose exit code says nothing here).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSnapshot, parseRatchetRows, type RatchetRow } from "./lib/metrics/snapshot.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const tag = flag("--tag");
const out = flag("--out");
if (!tag || !out || tag.startsWith("--") || out.startsWith("--")) {
  console.error("usage: bun run metrics -- --tag <vX.Y.Z> --out <file>");
  process.exit(2);
}

const snapshot = await buildSnapshot(
  {
    git: async (gitArgs) => {
      const ran = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); // NOSONAR: git from the PATH of the developer or the CI runner
      return { code: ran.status ?? 1, stdout: ran.stdout ?? "" };
    },
    arch: async (): Promise<RatchetRow[] | null> => {
      const dir = mkdtempSync(join(tmpdir(), "flightdeck-metrics-"));
      const file = join(dir, "arch.json");
      try {
        // Exit 1 means a figure is above its baseline: the rows are still written.
        spawnSync(process.execPath, ["run", "scripts/arch-report.ts", "--json", file], {
          cwd: ROOT,
          encoding: "utf8",
          maxBuffer: 1 << 28,
        }); // NOSONAR: bun itself, fixed arguments
        return parseRatchetRows(readFileSync(file, "utf8"));
      } catch {
        return null;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    now: () => new Date(),
  },
  tag,
).catch((error: Error) => {
  console.error(`metrics: ${error.message}`);
  return null;
});
if (snapshot === null) process.exit(1);
writeFileSync(resolve(out), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`metrics: wrote ${out} (${snapshot.unavailable.length} metric(s) unavailable)`);
