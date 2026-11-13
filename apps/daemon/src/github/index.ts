/**
 * The github domain's public entry (#1589, #1612): the one place `gh` is run from for a PR and for
 * the closed-issue count the ROI signals use. The rest of the domain moves behind this entry with
 * the remaining deep imports. Another domain imports from here, never a file inside.
 */

export { GithubCli } from "./adapters/gh-pr.ts";
export { type ClosedIssues, closedIssues } from "./adapters/issues-closed.ts";
