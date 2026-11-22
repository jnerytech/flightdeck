/**
 * Issue #3703: what `flightdeckd github status|repos|issues|login|logout|start` say, as pure rules over the answers of the daemon. The
 * daemon calls stay in `github/github-cli.ts`. A repository's description and an issue are written by anyone: the
 * printer cleans them, and an issue from outside the team is flagged before its text.
 */
import type {
  GithubLoginResult,
  GithubRepoItem,
  GithubStartResult,
  GithubStatusResult,
  Issue,
} from "@flightdeck/protocol";

export interface GithubCliArgs {
  action: "status" | "repos" | "issues" | "login" | "logout" | "start";
  /** `repos`: the text to look for in the names. */
  query?: string;
  /** `issues` and `start`: `owner/name`. */
  repo?: string;
  /** `login`: end the sign-in that is running instead of starting one. */
  cancel?: boolean;
  /** `start`: the allowed folder of the host to clone into. */
  root?: string;
  /** `start`: what to open on the clone. */
  mode?: "card" | "session";
  /** `start`: the issue whose text is the prompt. */
  issue?: string;
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

/** The one-time code of a sign-in and where to type it: the command never opens a page itself. */
export const loginLines = (login: GithubLoginResult): string[] => [
  `one-time code: ${login.code}`,
  `open ${login.url} and type the code there; run flightdeckd github status to see when the sign-in is done`,
];

/** What `github start` made: the folder (cloned now or already a clone), the project, and the card or session on it. */
export function startLines(started: GithubStartResult): string[] {
  const opened =
    started.cardId !== undefined
      ? [`card ${started.cardId}`]
      : started.sessionId !== undefined
        ? [`session ${started.sessionId}`]
        : [];
  return [
    `${started.reused ? "reused the clone in" : "cloned into"} ${started.path}`,
    `project ${started.projectId}`,
    ...opened,
  ];
}
