/**
 * The github domain's public entry (#1589, #1612): the PR provider and the issue provider that run
 * `gh`, the closed-issue count the ROI signals use, the `gh` runner types, the status and the alerts.
 * `main.ts` still builds the domain from `wiring.ts`, and `server-options.ts` takes the service type
 * from `service.ts`: the service imports the board, which imports this entry, so the entry cannot
 * re-export it without a cycle. Another domain imports from here, never a file inside.
 */

export { GithubIssues, TRUSTED_ASSOCIATIONS } from "./adapters/gh-issues.ts";
export { GithubCli } from "./adapters/gh-pr.ts";
export { type ClosedIssues, closedIssues } from "./adapters/issues-closed.ts";
export { githubCoords } from "./adapters/remote.ts";
export type { AlertList } from "./alerts.ts";
export type { GhResult, GhRunner } from "./gh-runner.ts";
export { githubStatus } from "./status.ts";
