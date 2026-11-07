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
  prRunFrom,
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
  // #741: gh is asked only for a push without an override, in the push's own checkout; any
  // failure reads as no run. The branch goes as one `--branch=` word, so no name reads as a flag.
  const gh = (args: string[], dir: string) => {
    // 3 s each: two calls stay inside the hook's 10 s with the git calls; gh never prompts.
    const proc = spawnSync("gh", args, {
      cwd: dir,
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    return proc.status === 0 ? proc.stdout : null;
  };
  const prRun = (branch: string, dir: string) => {
    const runs = gh(
      [
        "run",
        "list",
        `--branch=${branch}`,
        "--event=pull_request",
        "--limit=1",
        "--json=databaseId,status,startedAt,url",
      ],
      dir,
    );
    if (!runs || runs.trim() === "[]") return null;
    // `--` ends the flags, so the branch is always the PR to view.
    const pr = gh(["pr", "view", "--json=mergeable,statusCheckRollup", "--", branch], dir);
    return prRunFrom(runs, pr, Date.now());
  };
  block("push-wait", pushWaitViolation(command, cwd, { ...repo, env: process.env, prRun }));
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
for (const { rule, decision } of guardAllowLogs(command, process.env)) {
  logHook("guard", rule, decision);
}
process.exit(0);
