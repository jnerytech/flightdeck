#!/usr/bin/env bun
/**
 * `bun run claim <issue> [--by <session>] [--reassign | --release]` (issue #1410): claim an issue before
 * starting it; refused when another session owns it. The logic is in lib/pr/issue-claim.ts. The
 * session is --by, else FLIGHTDECK_SESSION; only FLIGHTDECK_COORDINATOR=1 may reassign.
 * `bun run claim --note <issue> <status> "<text>"` (#1526) is issue-note.sh's check before it posts:
 * exit 1 refuses a progress note whose "<session>: " prefix is not the owner.
 */
import { runCommand } from "../apps/daemon/src/board/command.ts";
import { claimIssue, noteCheck } from "./lib/pr/issue-claim.ts";

/** gh with its stderr kept and a deadline. */
const gh = async (args: string[]) => {
  const ran = await runCommand(["gh", ...args], process.cwd(), undefined, 30_000);
  return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout, stderr: ran.stderr };
};
const session = process.env.FLIGHTDECK_SESSION;
const deps = {
  gh,
  log: (line: string) => console.log(line),
  ...(session ? { session } : {}),
  coordinator: process.env.FLIGHTDECK_COORDINATOR === "1",
};
const args = process.argv.slice(2).filter((a) => a !== "--");
process.exit(
  args[0] === "--note" ? await noteCheck(args.slice(1), deps) : await claimIssue(args, deps),
);
