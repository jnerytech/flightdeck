#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Edit|Write): blocks staging everything at once (docs/TDD.md), hand edits of
 * generated files and test edits that add .only/.skip/test.todo/toMatchSnapshot, in the main
 * checkout and in its worktrees. Exit 2 blocks the call and shows
 * the reason to Claude. The rules live in scripts/lib/claude-hooks.ts, with their tests.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  checkoutRoot,
  commandViolation,
  generatedViolation,
  testEditViolation,
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
  block(
    testEditViolation(String(input?.tool_name), input.tool_input, (path) => {
      try {
        return readFileSync(resolve(ROOT, path), "utf8");
      } catch {
        return null;
      }
    }),
  );
}
process.exit(0);
