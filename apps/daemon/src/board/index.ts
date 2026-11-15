/**
 * The board domain's public entry (#1589). It exports, for now, the board's type, as the
 * automations' wiring takes it, the spec reader the card review uses, the `git diff` text parser the assistant shares, the `flightdeckd card`
 * command (#1507) and the file reads and writes inside a project folder, never through a link,
 * that the harness shares (#75, #78); the rest of the domain moves behind this entry with the remaining deep imports. Another domain
 * imports from here.
 */

export type { Board } from "./board.ts";
export { commitBase, commitOnNewBranch, safeGit } from "./branch-commit.ts";
export { runCardCli } from "./card-cli.ts";
export { createInside, readInside, type Walk, walkInside } from "./create-inside.ts";
export { cardDiff, workingDiff } from "./diff.ts";
export { parseUnifiedDiff } from "./domain/diff-parse.ts";
export { manageCard } from "./domain/manage.ts";
export { assertNoSecretInPr, withoutCredentials } from "./domain/pr-secrets.ts";
export { aheadBehind } from "./merge.ts";
export { prProvider } from "./pr.ts";
export { publishPr } from "./publish-pr.ts";
export { readSpecText } from "./spec.ts";
export { must } from "./worktree.ts";
