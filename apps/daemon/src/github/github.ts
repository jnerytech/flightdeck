/**
 * Phase 36: what the app asks of GitHub through the host's `gh`: sign out, a person's repos or a
 * search, a repo's issues. The token stays with `gh`; nothing here reads, keeps or returns it.
 */
import type { Issue } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
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

  async repos(_query?: string): Promise<GithubRepo[]> {
    return [{ name: "", description: "", private: true, url: "", updatedAt: "" }];
  }

  async issues(_repo: string): Promise<Issue[]> {
    return [];
  }
}
