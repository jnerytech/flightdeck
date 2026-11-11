/**
 * Issue #1918: an issue body is a mini-spec in a checked format (docs/issue-format.md). `checkIssue`
 * lists what is wrong with a body; `runIssue` is the CLI behind `bun run issue -- check|new|edit`.
 */
import type { GhResult } from "./ci-branch.ts";

export interface IssueDeps {
  /** Runs `gh <args>` in the repository. */
  gh(args: string[]): Promise<GhResult>;
  /** The text of a file, or null when it cannot be read. */
  readFile(path: string): string | null;
  log(line: string): void;
}

/** The problems of an issue body, one line each; empty when the body is valid. */
export function checkIssue(_body: string): string[] {
  return [];
}

/** `check`, `new` or `edit`: the exit code. */
export async function runIssue(_args: string[], _deps: IssueDeps): Promise<number> {
  return 0;
}
