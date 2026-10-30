#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Edit|Write): blocks staging everything at once (docs/TDD.md §5) and hand edits
 * of generated files. Exit 2 blocks the call and shows the reason to Claude.
 */
import { relative, resolve } from "node:path";
import { checkoutRoot } from "./checkout-root.ts";

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? resolve(import.meta.dir, "../.."));
const GENERATED = [
  "bun.lock",
  "coverage/",
  "dist/",
  "node_modules/",
  "release-assets/",
  "apps/desktop/dist/",
  "apps/desktop/src-tauri/gen/",
  "apps/desktop/src-tauri/target/",
];

function block(reason: string): never {
  console.error(reason);
  process.exit(2);
}

/** Tokens of each `git <sub>` invocation in a (possibly chained) shell command. */
function gitInvocations(command: string, sub: string): string[][] {
  const pattern = new RegExp(`\\bgit\\s+${sub}\\b([^;&|\\n]*)`, "g");
  return [...command.matchAll(pattern)].map((m) => (m[1] ?? "").trim().split(/\s+/));
}

function checkCommand(command: string) {
  for (const args of gitInvocations(command, "add")) {
    const wide = args.find(
      (a) => a === "." || a === "*" || a === "--all" || /^-[a-zA-Z]*A[a-zA-Z]*$/.test(a),
    );
    if (wide) {
      block(
        `git add ${wide} is blocked: stage files by explicit path and check git status --short first (docs/TDD.md §5).`,
      );
    }
  }
  for (const args of gitInvocations(command, "commit")) {
    for (const a of args) {
      if (a === "-m" || a === "--message" || a === "-F" || a.startsWith("-m")) break;
      if (a === "--all" || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a)) {
        block(
          `git commit ${a} is blocked: stage files by explicit path with git add <files> (docs/TDD.md §5).`,
        );
      }
    }
  }
}

/** Applies in the main checkout and in every worktree of the repository. */
function checkFile(filePath: string) {
  const root = checkoutRoot(filePath, ROOT);
  if (!root) return;
  const rel = relative(root, resolve(ROOT, filePath)).replaceAll("\\", "/");
  if (rel === "") return;
  const hit = GENERATED.find((g) => (g.endsWith("/") ? rel.startsWith(g) : rel === g));
  if (hit) {
    block(
      `${rel} is generated (${hit}): change its source or rerun the tool that writes it (bun install, the build, bun test).`,
    );
  }
}

const input = await Bun.stdin.json().catch(() => null);
const toolInput = input?.tool_input ?? {};
if (typeof toolInput.command === "string") checkCommand(toolInput.command);
if (typeof toolInput.file_path === "string") checkFile(toolInput.file_path);
process.exit(0);
