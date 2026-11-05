#!/usr/bin/env bun
/**
 * `bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n>] | next | update <n> |
 * auto <n> | merge <n>` (issue #260, GitHub Flow; auto #271). The logic is in lib/pr-flow.ts;
 * merge needs FLIGHTDECK_COORDINATOR=1.
 */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { prFlow } from "./lib/pr-flow.ts";

process.exit(
  await prFlow(
    process.argv.slice(2).filter((a) => a !== "--"),
    {
      gh: (cmd) => spawnExec(["gh", ...cmd]),
      git: (cmd) => spawnExec(["git", ...cmd]),
      // The FLIGHTDECK_PR_OPENED hook (#273): two minutes at most, then it is killed.
      run: async (cmd) => {
        const proc = Bun.spawn(cmd, {
          stdout: "pipe",
          stderr: "ignore",
          stdin: "ignore",
          timeout: 120_000,
        });
        const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return { code, stdout };
      },
      env: process.env,
      log: (line) => console.log(line),
    },
  ),
);
