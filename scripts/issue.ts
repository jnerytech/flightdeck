#!/usr/bin/env bun
/**
 * `bun run issue -- check (--body-file <md> | <n>) | new --title "<t>" --body-file <md> |
 * edit <n> --body-file <md>` (issue #1918): an issue body is a mini-spec in the format of
 * docs/issue-format.md. The logic is in lib/pr/issue-spec.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { runCommand } from "../apps/daemon/src/board/command.ts";
import { runIssue } from "./lib/pr/issue-spec.ts";

const args = process.argv.slice(2).filter((a) => a !== "--");
process.exit(
  await runIssue(args, {
    gh: async (ghArgs) => {
      const ran = await runCommand(["gh", ...ghArgs], process.cwd(), undefined, 30_000);
      return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout, stderr: ran.stderr };
    },
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    log: (line) => console.log(line),
  }),
);
