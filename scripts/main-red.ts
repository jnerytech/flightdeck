#!/usr/bin/env bun
/**
 * `bun run main-red [-- claim "<cause>" [--by <name>]]` (issue #1246). The logic is in
 * lib/main-red.ts. The owner of a claim is --by, else FLIGHTDECK_SESSION, else the tmux session.
 */
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { mainRed } from "./lib/main-red.ts";

const tmux = process.env.TMUX
  ? (await spawnExec(["tmux", "display-message", "-p", "#S"]).catch(() => null))?.stdout.trim()
  : "";
process.exit(
  await mainRed(process.argv.slice(2), {
    gh: (cmd) => spawnExec(["gh", ...cmd]),
    log: (line) => console.log(line),
    owner: process.env.FLIGHTDECK_SESSION || tmux || "unknown",
  }),
);
