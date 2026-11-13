/**
 * The github domain's public entry (#1589, #1612): the PR provider and the issue provider that run
 * `gh`, and the closed-issue count the ROI signals use. The `gh` runner and the login still sit
 * outside this entry; they move behind it with the remaining deep imports. Another domain imports
 * from here, never a file inside.
 */

export { GithubIssues, TRUSTED_ASSOCIATIONS } from "./adapters/gh-issues.ts";
export { GithubCli } from "./adapters/gh-pr.ts";
export { type ClosedIssues, closedIssues } from "./adapters/issues-closed.ts";
