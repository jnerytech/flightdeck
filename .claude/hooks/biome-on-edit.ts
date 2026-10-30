#!/usr/bin/env bun
/**
 * PostToolUse (Edit|Write): `biome check --write` on the edited file, in the checkout it belongs
 * to (the main one or a worktree); exit 2 hands what is left to Claude.
 */
import { relative, resolve } from "node:path";
import { checkoutRoot } from "./checkout-root.ts";

const CHECKED = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$/i;
const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dir, "../.."));

const input = await Bun.stdin.json().catch(() => null);
const filePath: unknown = input?.tool_input?.file_path;
if (typeof filePath !== "string" || !CHECKED.test(filePath)) process.exit(0);

const root = checkoutRoot(filePath, ROOT);
if (!root) process.exit(0);
const rel = relative(root, resolve(ROOT, filePath));
if (rel === "") process.exit(0);

const proc = Bun.spawnSync(
  [
    "bun",
    "x",
    "biome",
    "check",
    "--write",
    "--no-errors-on-unmatched",
    "--files-ignore-unknown=true",
    rel,
  ],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
);
if (proc.exitCode === 0) process.exit(0);

const output = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim();
console.error(`biome check ${rel} still reports problems:\n${output.slice(0, 4000)}`);
process.exit(2);
