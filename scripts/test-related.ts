#!/usr/bin/env bun
/** `bun run test:related [--base <ref>]`: runs only the tests that reach the files changed since the base. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planRelated } from "./lib/test-related.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = args.indexOf("--base");

const plan = planRelated({
  base: flag >= 0 ? args[flag + 1] : undefined,
  platform: process.platform,
  git: (gitArgs) => {
    const proc = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => readFileSync(resolve(ROOT, path), "utf8"),
});
(plan.code === 0 ? console.log : console.error)(plan.output);
if (!plan.command) process.exit(plan.code);
const [cmd = "bun", ...rest] = plan.command;
const proc = Bun.spawn([cmd === "bun" ? process.execPath : cmd, ...rest], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await proc.exited);
