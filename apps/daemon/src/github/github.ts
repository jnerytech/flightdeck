/**
 * Phase 36: what the app asks of GitHub through the host's `gh`: sign out, a person's repos or a
 * search, a repo's issues. The token stays with `gh`; nothing here reads, keeps or returns it.
 */
import type { Issue } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { GH_FIELDS, type GhIssue, GithubIssues } from "../issues/providers.ts";
import type { GhResult, GhRunner } from "./gh.ts";
import { GITHUB_HOST, type GithubStatus, githubStatus } from "./status.ts";

const refuse = (reason: string, message: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", message, reason, params);

/** The last line gh printed, which is the one that says what went wrong. */
const detailOf = (result: GhResult) =>
  `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .shift()
    ?.slice(0, 300) ?? "";

const LIST_LIMIT = 50;
const ISSUE_LIMIT = 50;
/** `owner/name`: letters, digits, dots, underscores and dashes. */
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;
const SEARCH_LIMIT = 30;

/** A repo is `owner/name`, checked before it reaches gh as an argument. */
export function checkRepo(repo: string): void {
  if (!REPO.test(repo) || /\/\.+$/.test(repo)) {
    throw refuse("repo_invalid", `${repo} is not an owner/name repository`, { repo });
  }
}

export interface GithubRepo {
  /** `owner/name`. */
  name: string;
  description: string;
  private: boolean;
  url: string;
  updatedAt: string;
}

export interface GithubOptions {
  gh: GhRunner;
}

export class Github {
  constructor(private readonly opts: GithubOptions) {}

  /** The status, refused with a reason when gh is missing or nobody is signed in. */
  private async signedIn(): Promise<GithubStatus> {
    const status = await githubStatus(this.opts.gh);
    if (!status.installed) throw refuse("gh_missing", "gh is not installed on this host");
    if (!status.loggedIn) throw refuse("gh_logged_out", "gh is not signed in to GitHub");
    return status;
  }

  /** Signs gh out. A login that comes from the environment is not ours to remove. */
  async logout(): Promise<void> {
    const status = await this.signedIn();
    if (status.source === "env") {
      throw refuse("login_from_env", "the login comes from an environment variable of the daemon");
    }
    const result = await this.opts.gh(["auth", "logout", "--hostname", GITHUB_HOST]);
    if (result && result.code !== 0) {
      const detail = detailOf(result);
      throw refuse("logout_failed", `gh auth logout failed: ${detail}`, { detail });
    }
  }

  /** Needs the `repo` scope when gh says which scopes it has (a fine-grained token does not). */
  async ensureAccess(): Promise<void> {
    const status = await this.signedIn();
    if (status.scopes.length > 0 && !status.scopes.includes("repo")) {
      throw refuse("gh_scope_missing", "the GitHub login lacks the repo scope", { scope: "repo" });
    }
  }

  /** The person's repos, or a search with `query` (one argument after `--`, never a flag). */
  async repos(query?: string): Promise<GithubRepo[]> {
    if (query !== undefined && (query.length > 100 || [...query].some((c) => c < " "))) {
      throw refuse("query_invalid", "the search text is too long or has control characters");
    }
    await this.ensureAccess();
    const search = query !== undefined && query.trim() !== "";
    const result = await this.opts.gh(
      search
        ? [
            "search",
            "repos",
            "--json",
            "fullName,description,isPrivate,url,updatedAt",
            "--limit",
            String(SEARCH_LIMIT),
            "--",
            query,
          ]
        : [
            "repo",
            "list",
            "--json",
            "nameWithOwner,description,isPrivate,url,updatedAt",
            "--limit",
            String(LIST_LIMIT),
          ],
    );
    if (!result || result.code !== 0) {
      const detail = result ? detailOf(result) : "";
      throw refuse("repos_failed", `gh could not list the repos: ${detail}`, { detail });
    }
    const rows = JSON.parse(result.stdout || "[]") as Array<{
      nameWithOwner?: string;
      fullName?: string;
      description: string | null;
      isPrivate: boolean;
      url: string;
      updatedAt: string;
    }>;
    return rows.map((row) => ({
      name: row.nameWithOwner ?? row.fullName ?? "",
      description: row.description ?? "",
      private: row.isPrivate,
      url: row.url,
      updatedAt: row.updatedAt,
    }));
  }

  /** One issue of `repo`, as the app shows it; a number gh does not know is `issue_not_found`. */
  async issue(repo: string, id: string): Promise<Issue> {
    checkRepo(repo);
    if (!/^\d+$/.test(id)) throw refuse("issue_invalid", `${id} is not an issue number`, { id });
    await this.ensureAccess();
    const result = await this.opts.gh(["issue", "view", id, "-R", repo, "--json", GH_FIELDS]);
    if (!result || result.code !== 0) {
      const detail = result ? detailOf(result) : "";
      if (/could not resolve|not found/i.test(detail)) {
        throw refuse("issue_not_found", `issue ${id} of ${repo} was not found`, { repo, id });
      }
      throw refuse("issues_failed", `gh could not read the issue: ${detail}`, { detail });
    }
    const me = await this.opts.gh(["api", "user", "--jq", ".login"]);
    const login = me && me.code === 0 ? me.stdout.trim().toLowerCase() || null : null;
    return new GithubIssues(repo).toIssue(JSON.parse(result.stdout) as GhIssue, login);
  }

  /** The open issues of `repo` (`owner/name`), asked of GitHub whatever folder the daemon is in. */
  async issues(repo: string): Promise<Issue[]> {
    checkRepo(repo);
    await this.ensureAccess();
    const result = await this.opts.gh([
      "issue",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--json",
      GH_FIELDS,
      "--limit",
      String(ISSUE_LIMIT),
    ]);
    if (!result || result.code !== 0) {
      const detail = result ? detailOf(result) : "";
      if (/could not resolve to a repository|not found/i.test(detail)) {
        throw refuse("repo_not_found", `${repo} was not found on GitHub`, { repo });
      }
      throw refuse("issues_failed", `gh could not list the issues: ${detail}`, { detail });
    }
    const me = await this.opts.gh(["api", "user", "--jq", ".login"]);
    const login = me && me.code === 0 ? me.stdout.trim().toLowerCase() || null : null;
    const provider = new GithubIssues(repo);
    return (JSON.parse(result.stdout || "[]") as GhIssue[]).map((issue) =>
      provider.toIssue(issue, login),
    );
  }
}
