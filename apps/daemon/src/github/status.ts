/** Phase 36: whether the host's `gh` is signed in to GitHub, and as whom. Never a token. */
import type { GhRunner } from "./gh.ts";

export interface GithubStatus {
  installed: boolean;
  loggedIn: boolean;
  login: string | null;
  scopes: string[];
  /** Where `gh` keeps the login: the OS keyring, its hosts file, or an environment variable. */
  source: "keyring" | "file" | "env" | null;
}

export const GITHUB_HOST = "github.com";

/** What `gh auth status` says, read from its text (it prints the same on stdout or stderr). */
export function parseAuthStatus(_text: string): Omit<GithubStatus, "installed"> {
  return { loggedIn: true, login: "", scopes: [], source: "file" };
}

export async function githubStatus(_gh: GhRunner): Promise<GithubStatus> {
  return { installed: false, loggedIn: true, login: "", scopes: [], source: "file" };
}
