#!/usr/bin/env bun
/** `bun run tdd:audit -- --since <tag>`: checks that every feat/fix has an earlier test commit. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAudit } from "./lib/tdd-audit.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = args.indexOf("--since");
const since = flag >= 0 ? args[flag + 1] : undefined;
if (!since) {
  console.error("uso: bun run tdd:audit -- --since <tag>");
  process.exit(2);
}

const result = runAudit({
  since,
  git: (gitArgs) => {
    const proc = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" });
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => readFileSync(resolve(ROOT, path), "utf8"),
});
(result.code === 0 ? console.log : console.error)(result.output);
process.exit(result.code);
