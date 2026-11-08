#!/usr/bin/env bun
import { runCommand } from "../apps/daemon/src/board/command.ts";
/**
 * `bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n> | --refs <n>] | next | update <n> |
 * auto <n> | merge <n>` (issue #260, GitHub Flow; auto #271). The logic is in lib/pr-flow.ts;
 * merge needs FLIGHTDECK_COORDINATOR=1.
 */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { runBounded } from "./lib/bounded-run.ts";
import { mainRedWithin } from "./lib/main-red.ts";
import { prFlow } from "./lib/pr-flow.ts";

process.exit(
  await prFlow(
    process.argv.slice(2).filter((a) => a !== "--"),
    {
      gh: (cmd) => spawnExec(["gh", ...cmd]),
      git: (cmd) => spawnExec(["git", ...cmd]),
      // The FLIGHTDECK_PR_OPENED hook (#273): two minutes at most, then its whole group is killed;
      // 124 when it ran past the deadline, 127 when it could not start (as a shell says).
      run: async (cmd) => {
        const { code, timedOut } = await runBounded(cmd, 120_000);
        return { code: timedOut ? 124 : (code ?? 127), stdout: "" };
      },
      env: process.env,
      log: (line) => console.log(line),
      // #1246: a red main and its claim, said before a PR moves; 3 s at most, then nothing.
      mainRed: () =>
        mainRedWithin(
          {
            gh: async (cmd) => {
              const ran = await runCommand(["gh", ...cmd], process.cwd(), undefined, 3000);
              return {
                code: ran.timedOut ? 124 : ran.code,
                stdout: ran.stdout,
                stderr: ran.stderr,
              };
            },
          },
          3000,
        ),
    },
  ),
);
