#!/usr/bin/env bun
/**
 * `bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n>] | next | update <n> |
 * auto <n> | merge <n>` (issue #260, GitHub Flow; auto #271). The logic is in lib/pr-flow.ts;
 * merge needs FLIGHTDECK_COORDINATOR=1.
 */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { runBounded } from "./lib/bounded-run.ts";
import { prFlow } from "./lib/pr-flow.ts";

process.exit(
  await prFlow(
    process.argv.slice(2).filter((a) => a !== "--"),
    {
      gh: (cmd) => spawnExec(["gh", ...cmd]),
      git: (cmd) => spawnExec(["git", ...cmd]),
      // The FLIGHTDECK_PR_OPENED hook (#273): two minutes at most, then its whole group is killed.
      run: async (cmd) => {
        const { code, stderr, timedOut } = await runBounded(cmd, 120_000);
        return {
          code: code ?? 1,
          stdout: "",
          stderr: timedOut ? `timed out after 120 s ${stderr}` : stderr,
        };
      },
      env: process.env,
      log: (line) => console.log(line),
    },
  ),
);
