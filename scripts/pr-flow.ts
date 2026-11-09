#!/usr/bin/env bun
/**
 * `bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n> | --refs <n>] | next | update <n> |
 * auto <n> [--now] | merge <n>` (issue #260, GitHub Flow; auto #271). The logic is in lib/pr-flow.ts;
 * merge needs FLIGHTDECK_COORDINATOR=1.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCommand } from "../apps/daemon/src/board/command.ts";
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { runBounded } from "./lib/bounded-run.ts";
import { mainRedWithin } from "./lib/main-red.ts";
import { prFlow } from "./lib/pr-flow.ts";

// #1526: the OpenCode reviews the coordinator's tooling writes next to the checkout (or
// FLIGHTDECK_PR_REVIEWS); where there is no such folder, pr auto says nothing about a review.
const reviews =
  process.env.FLIGHTDECK_PR_REVIEWS ??
  resolve(import.meta.dir, "../../flightdeck-handoff/pr-reviews");
const review = async (n: number) => {
  const file = join(reviews, `pr-${n}.md`);
  // An unreadable review (a folder in its place, no permission) counts as none yet.
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
};

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
      ...(existsSync(reviews) ? { review } : {}),
      // #1246: a red main and its claim, said before a PR moves; 6 s at most (#1381), then nothing.
      mainRed: () =>
        mainRedWithin(
          {
            gh: async (cmd) => {
              const ran = await runCommand(["gh", ...cmd], process.cwd(), undefined, 6000);
              return {
                code: ran.timedOut ? 124 : ran.code,
                stdout: ran.stdout,
                stderr: ran.stderr,
              };
            },
          },
          6000,
        ),
    },
  ),
);
