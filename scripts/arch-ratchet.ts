#!/usr/bin/env bun
/**
 * `bun run scripts/arch-ratchet.ts`: fails when .dependency-cruiser-known-violations.json has more
 * violations of a rule than at the merge-base with main (issue #1591). `bun run arch` runs it after
 * dependency-cruiser. The logic is scripts/lib/ratchets/arch.ts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runArchRatchet } from "./lib/ratchets/arch.ts";

const ROOT = resolve(import.meta.dir, "..");
const result = runArchRatchet({
  git: (args) => {
    const proc = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); // NOSONAR: git from the PATH of the developer or the CI runner
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => {
    try {
      return readFileSync(resolve(ROOT, path), "utf8");
    } catch {
      return null;
    }
  },
});
(result.code === 0 ? console.log : console.error)(result.output);
process.exit(result.code);
