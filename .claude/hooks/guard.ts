#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Edit|Write), in the main checkout and in its worktrees. It blocks staging
 * everything at once (docs/TDD.md), hand edits of generated files, test edits that add
 * .only/.skip/test.todo/toMatchSnapshot, commits whose subject breaks the format or the TDD
 * order, heavy runs outside `bun run slot --`, a worker's full coverage run (#674), a session's hand merge or tag of a PR, and pushes of anything but the session's own work
 * branch, and a push that would cancel the branch's PR run while it is still green (#741). Exit 2 blocks the call and shows the reason to Claude. The rules live in
 * scripts/lib/claude-hooks.ts, with their tests.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  checkoutRoot,
  commandViolation,
  commitViolation,
  generatedViolation,
  guardAllowLogs,
  heavyRunViolation,
  prMergeViolation,
  prRunVia,
  pushViolation,
  pushWaitViolation,
  slotViolation,
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
// #741: the push context of the log, so a push-wait override records the run's age.
let push: Parameters<typeof guardAllowLogs>[2];
if (typeof command === "string") {
  block("command", commandViolation(command));
  block("slot", slotViolation(command, process.env));
  block("slot-heavy", heavyRunViolation(command, process.env));
  block("pr-merge", prMergeViolation(command, process.env));
  const cwd = typeof input.cwd === "string" ? input.cwd : ROOT;
  const repo = {
    git: (args: string[], dir: string) => {
      const proc = spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: 2000 });
      return proc.status === 0 ? proc.stdout : null;
    },
    inProject: (dir: string) => checkoutRoot(join(dir, "x"), ROOT) !== null,
  };
  block("commit", commitViolation(command, cwd, repo));
  block("push", pushViolation(command, cwd, { ...repo, env: process.env }));
  // #741: gh is asked for a push, in the push's own checkout: without an override to decide, with
  // one to log the run's age. Any failure reads as no run (prRunVia in scripts/lib/claude-hooks.ts).
  const gh = (args: string[], dir: string) => {
    // 3 s each: two calls stay inside the hook's 10 s with the git calls; gh never prompts. Past
    // the 10 s, Claude Code lets the command through, so a slow GitHub fails open too.
    const proc = spawnSync("gh", args, {
      cwd: dir,
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    return proc.status === 0 ? proc.stdout : null;
  };
  const prRun = prRunVia(gh, Date.now);
  push = { cwd, deps: { ...repo, env: process.env, prRun } };
  block("push-wait", pushWaitViolation(command, cwd, push.deps));
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
for (const { rule, decision, detail, minutes } of guardAllowLogs(command, process.env, push)) {
  logHook("guard", rule, decision, { detail, minutes });
}
process.exit(0);
