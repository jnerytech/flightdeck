#!/usr/bin/env bun
/**
 * `bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n>] | next | update <n> |
 * merge <n>` (issue #260, GitHub Flow). The logic is in lib/pr-flow.ts; merge needs
 * FLIGHTDECK_COORDINATOR=1.
 */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { prFlow } from "./lib/pr-flow.ts";

process.exit(
  await prFlow(
    process.argv.slice(2).filter((a) => a !== "--"),
    {
      gh: (cmd) => spawnExec(["gh", ...cmd]),
      git: (cmd) => spawnExec(["git", ...cmd]),
      env: process.env,
      log: (line) => console.log(line),
    },
  ),
);
