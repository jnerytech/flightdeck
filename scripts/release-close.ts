#!/usr/bin/env bun
/**
 * `bun run release:close -- <tag> [--apply] [--since <tag>]` (issue #252): closes what a release
 * tag shipped. A dry run by default. The board goes through FLIGHTDECK_BOARD_CMD when it is set,
 * called as `<cmd> <issue> done ""` (the coordinator's issue-note.sh, with its REST queue of #242).
 * The logic is in `lib/release-close.ts`.
 */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { releaseClose } from "./lib/release-close.ts";

const args = process.argv.slice(2).filter((a) => a !== "--");
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;
const tag = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--since");
if (!tag || (args.includes("--since") && !since)) {
  console.error("usage: bun run release:close -- <tag> [--apply] [--since <tag>]");
  process.exit(2);
}
const board = process.env.FLIGHTDECK_BOARD_CMD;
process.exit(
  await releaseClose(
    tag,
    { apply: args.includes("--apply"), ...(since ? { since } : {}) },
    {
      gh: (cmd) => spawnExec(["gh", ...cmd]),
      git: (cmd) => spawnExec(["git", ...cmd]),
      ...(board
        ? {
            board: async (issue) =>
              (await spawnExec([board, String(issue), "done", ""])).code === 0,
          }
        : {}),
      log: (line) => console.log(line),
    },
  ),
);
