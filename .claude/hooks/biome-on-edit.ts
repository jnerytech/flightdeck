#!/usr/bin/env bun
/**
 * PostToolUse (Edit|Write): Biome fixes the edited file and reports what is left, in the checkout
 * it belongs to (the main one or a worktree); exit 2 hands what is left to Claude. No project
 * scan (checkEditedFile, #1566), so the type-aware rules are left to `bun run lint`.
 */
import { relative, resolve } from "node:path";
import { checkEditedFile, checkoutRoot } from "../../scripts/lib/claude-hooks.ts";
import { logHook } from "./log.ts";

const CHECKED = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$/i;
const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dir, "../.."));

const input = await Bun.stdin.json().catch(() => null);
const filePath: unknown = input?.tool_input?.file_path;
if (typeof filePath !== "string" || !CHECKED.test(filePath)) process.exit(0);

const root = checkoutRoot(filePath, ROOT);
if (!root) process.exit(0);
const rel = relative(root, resolve(ROOT, filePath));

const result = checkEditedFile(root, rel);
if (result.ok) {
  logHook("biome-on-edit", null);
  process.exit(0);
}
logHook("biome-on-edit", "biome");

console.error(`biome check ${rel} still reports problems:\n${result.output.slice(0, 4000)}`);
process.exit(2);
