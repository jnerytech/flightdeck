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
  type PushWaitPass,
  prMergeViolation,
  prRunVia,
  pushViolation,
  pushWaitCheck,
  slotViolation,
  testEditViolation,
  withBudget,
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
// #741: why push-wait let each pushed branch go, for the log.
let passes: PushWaitPass[] = [];
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
  // one to log the run's age. A failure reads as GitHub unread: asked once more, then the push holds
  // with the override line (prRunVia and pushWaitCheck in scripts/lib/claude-hooks.ts).
  const gh = (args: string[], dir: string) => {
    // 3 s each, and each starts only in the first 6 s (withBudget), so the retry never takes the
    // hook past its 10 s; one that cannot start reads as GitHub unread. gh never prompts.
    const proc = spawnSync("gh", args, {
      cwd: dir,
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    return proc.status === 0 ? proc.stdout : null;
  };
  const prRun = prRunVia(
    withBudget(gh, () => performance.now(), 6000),
    Date.now,
  );
  push = { cwd, deps: { ...repo, env: process.env, prRun } };
  const decision = pushWaitCheck(command, cwd, push.deps);
  passes = decision.passes;
  block("push-wait", decision.violation);
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
// The run's age is only for the log: its git calls, like every gh call, start only in the first 6 s
// of the hook, so each ends inside the hook's 10 s (approximately: gh 3 s, git 2 s; #826 review).
const logged = push && {
  ...push,
  deps: { ...push.deps, git: withBudget(push.deps.git, () => performance.now(), 6000) },
};
for (const { rule, decision, detail, minutes } of guardAllowLogs(
  command,
  process.env,
  logged,
  passes,
)) {
  logHook("guard", rule, decision, { detail, minutes });
}
process.exit(0);
