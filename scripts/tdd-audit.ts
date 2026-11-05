#!/usr/bin/env bun
/**
 * `bun run tdd:audit -- --since <tag|commit|auto>`: checks that every feat/fix has an earlier test
 * commit. `auto` (the default) audits from the merge-base with main, or from the last tag on main.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWaivers, runAudit } from "./lib/tdd-audit.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = args.indexOf("--since");
// Without --since, the audit runs from the merge-base with main (or the last tag on main).
const since = flag >= 0 ? args[flag + 1] : "auto";
if (!since) {
  console.error("usage: bun run tdd:audit -- --since <tag|commit|auto>");
  process.exit(2);
}

const result = runAudit({
  since,
  waivers: parseWaivers(readFileSync(resolve(ROOT, "scripts/tdd-audit-waivers.json"), "utf8")),
  git: (gitArgs) => {
    const proc = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" });
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => readFileSync(resolve(ROOT, path), "utf8"),
});
(result.code === 0 ? console.log : console.error)(result.output);
process.exit(result.code);
