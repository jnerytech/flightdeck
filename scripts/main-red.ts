#!/usr/bin/env bun
/**
 * `bun run main-red [-- claim "<cause>" [--by <name>]]` (issue #1246). The logic is in
 * lib/main-red.ts. The owner of a claim is --by, else FLIGHTDECK_SESSION, else the tmux session.
 */
import { runCommand } from "../apps/daemon/src/board/command.ts";
import { mainRed } from "./lib/main-red.ts";

/** gh with its stderr kept (a missing label is told by it) and a deadline. */
const gh = async (args: string[]) => {
  const ran = await runCommand(["gh", ...args], process.cwd(), undefined, 30_000);
  return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout, stderr: ran.stderr };
};
const tmux = process.env.TMUX
  ? (
      await runCommand(["tmux", "display-message", "-p", "#S"], process.cwd(), undefined, 2000)
    ).stdout.trim()
  : "";
process.exit(
  await mainRed(process.argv.slice(2), {
    gh,
    log: (line) => console.log(line),
    owner: process.env.FLIGHTDECK_SESSION || tmux || "unknown",
  }),
);
