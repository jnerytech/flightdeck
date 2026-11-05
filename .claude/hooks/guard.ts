#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Edit|Write): blocks staging everything at once (docs/TDD.md), hand edits of
 * generated files, test edits that add .only/.skip/test.todo/toMatchSnapshot, and commits whose
 * subject breaks the format or the TDD order, in the main checkout and in its worktrees. Exit 2 blocks the call and shows
 * the reason to Claude. The rules live in scripts/lib/claude-hooks.ts, with their tests.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  checkoutRoot,
  commandViolation,
  commitViolation,
  generatedViolation,
  testEditViolation,
} from "../../scripts/lib/claude-hooks.ts";
import { logHook } from "./log.ts";

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dir, "../.."));

function block(rule: string, reason: string | null) {
  if (!reason) return;
  logHook("guard", rule);
  console.error(reason);
  process.exit(2);
}

const input = await Bun.stdin.json().catch(() => null);
const { command, file_path: filePath } = input?.tool_input ?? {};
if (typeof command === "string") {
  block("command", commandViolation(command));
  const cwd = typeof input.cwd === "string" ? input.cwd : ROOT;
  block(
    "commit",
    commitViolation(command, cwd, {
      git: (args, dir) => {
        const proc = spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: 5000 });
        return proc.status === 0 ? proc.stdout : null;
      },
    }),
  );
}
if (typeof filePath === "string") {
  const root = checkoutRoot(filePath, ROOT);
  if (root) block("generated", generatedViolation(relative(root, resolve(ROOT, filePath))));
  block(
    "test-marker",
    testEditViolation(String(input?.tool_name), input.tool_input, (path) => {
      try {
        return readFileSync(resolve(ROOT, path), "utf8");
      } catch {
        return null;
      }
    }),
  );
}
logHook("guard", null);
process.exit(0);
