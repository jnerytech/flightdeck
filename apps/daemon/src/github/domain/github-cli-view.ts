/**
 * Issue #3703: what `flightdeckd github status|repos|issues` say, as pure rules over the answers of the daemon. The
 * daemon calls stay in `github/github-cli.ts`. A repository's description and an issue are written by anyone: the
 * printer cleans them, and an issue from outside the team is flagged before its text.
 */
import type { GithubRepoItem, GithubStatusResult, Issue } from "@flightdeck/protocol";

export interface GithubCliArgs {
  action: "status" | "repos" | "issues";
  /** `repos`: the text to look for in the names. */
  query?: string;
  /** `issues`: `owner/name`. */
  repo?: string;
  json?: boolean;
}

const SOURCES: Record<string, string> = {
  keyring: "keyring",
  file: "file",
  env: "environment token",
};

/** Who `gh` is signed in as and where its login lives, then the scopes the token has. Never the token. */
export function statusLines(status: GithubStatusResult): string[] {
  if (!status.installed) return ["gh is not installed on this host"];
  if (!status.loggedIn) return ["gh is not signed in on this host"];
  const source = status.source === null ? "" : ` (${SOURCES[status.source] ?? status.source})`;
  return [
    `signed in as ${status.login ?? "an unnamed account"}${source}`,
    ...(status.scopes.length === 0 ? [] : [`scopes: ${status.scopes.join(", ")}`]),
  ];
}

/** The five keys of the status and nothing the daemon might add. */
export const statusJson = (status: GithubStatusResult) => ({
  installed: status.installed,
  loggedIn: status.loggedIn,
  login: status.login,
  scopes: status.scopes,
  source: status.source,
});

/** One line per repository: its name, whether it is private, when it changed and its description. */
export function repoLines(repos: GithubRepoItem[]): string[] {
  return repos.length === 0
    ? ["no repositories"]
    : repos.map((repo) =>
        [
          repo.name,
          repo.private ? "private" : "public",
          repo.updatedAt,
          ...(repo.description === "" ? [] : [repo.description]),
        ].join("  "),
      );
}

const EXTERNAL = "EXTERNAL: written by someone outside the team";

/** An issue on one line, as `issues list` prints it. */
function issueLine(issue: Issue): string {
  return [
    issue.ref,
    ...(issue.external ? [EXTERNAL] : []),
    issue.title,
    ...(issue.labels.length > 0 ? [`[${issue.labels.join(", ")}]`] : []),
    `by ${issue.author}`,
  ].join("  ");
}

export const issueListLines = (issues: Issue[]): string[] =>
  issues.length === 0 ? ["no issues"] : issues.map(issueLine);
