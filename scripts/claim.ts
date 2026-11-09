#!/usr/bin/env bun
/**
 * `bun run claim <issue> [--by <session>] [--reassign | --release]` (issue #1410): claim an issue before
 * starting it; refused when another session owns it. The logic is in lib/issue-claim.ts. The
 * session is --by, else FLIGHTDECK_SESSION; only FLIGHTDECK_COORDINATOR=1 may reassign.
 */
import { runCommand } from "../apps/daemon/src/board/command.ts";
import { claimIssue } from "./lib/issue-claim.ts";

/** gh with its stderr kept and a deadline. */
const gh = async (args: string[]) => {
  const ran = await runCommand(["gh", ...args], process.cwd(), undefined, 30_000);
  return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout, stderr: ran.stderr };
};
const session = process.env.FLIGHTDECK_SESSION;
process.exit(
  await claimIssue(process.argv.slice(2), {
    gh,
    log: (line) => console.log(line),
    ...(session ? { session } : {}),
    coordinator: process.env.FLIGHTDECK_COORDINATOR === "1",
  }),
);
