#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Edit|Write): blocks staging everything at once (docs/TDD.md) and hand edits of
 * generated files, in the main checkout and in its worktrees. Exit 2 blocks the call and shows
 * the reason to Claude. The rules live in scripts/lib/claude-hooks.ts, with their tests.
 */
import { relative, resolve } from "node:path";
import {
  checkoutRoot,
  commandViolation,
  generatedViolation,
} from "../../scripts/lib/claude-hooks.ts";

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dir, "../.."));

function block(reason: string | null) {
  if (!reason) return;
  console.error(reason);
  process.exit(2);
}

const input = await Bun.stdin.json().catch(() => null);
const { command, file_path: filePath } = input?.tool_input ?? {};
if (typeof command === "string") block(commandViolation(command));
if (typeof filePath === "string") {
  const root = checkoutRoot(filePath, ROOT);
  if (root) block(generatedViolation(relative(root, resolve(ROOT, filePath))));
}
process.exit(0);
