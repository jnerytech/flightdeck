#!/usr/bin/env bun
/**
 * `bun run scripts/release-highlights.ts [--since <tag>]` (issue #1334): prints a draft of the
 * release's Highlights from the PRs merged since the last release (or <tag>). The logic is in
 * lib/release/highlights.ts; it only reads, with gh.
 */
import { runCommand } from "../apps/daemon/src/kernel/command.ts";
import { releaseHighlights } from "./lib/release/highlights.ts";

/** gh with its stderr kept and a deadline. */
const gh = async (args: string[]) => {
  const ran = await runCommand(["gh", ...args], process.cwd(), undefined, 60_000);
  return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout, stderr: ran.stderr };
};
process.exit(
  await releaseHighlights(process.argv.slice(2), {
    gh,
    log: (line) => console.log(line),
    warn: (line) => console.error(line),
  }),
);
