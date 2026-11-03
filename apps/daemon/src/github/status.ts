/** Phase 37: whether the host's `gh` is signed in to GitHub, and as whom. Never a token. */
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
export function parseAuthStatus(text: string): Omit<GithubStatus, "installed"> {
  const account = /Logged in to \S+ account (\S+) \(([^)]*)\)/.exec(text);
  if (!account) return { loggedIn: false, login: null, scopes: [], source: null };
  const where = account[2] ?? "";
  const source = /^(GH|GITHUB)_TOKEN$|^GH_ENTERPRISE_TOKEN$/.test(where)
    ? "env"
    : where === "keyring"
      ? "keyring"
      : "file";
  const scopes = /Token scopes:\s*(.*)/.exec(text)?.[1] ?? "";
  return {
    loggedIn: true,
    login: account[1] ?? null,
    scopes: [...scopes.matchAll(/'([^']+)'/g)].map((match) => match[1] as string),
    source,
  };
}

export async function githubStatus(gh: GhRunner): Promise<GithubStatus> {
  const result = await gh(["auth", "status", "--hostname", GITHUB_HOST]);
  if (!result) return { installed: false, loggedIn: false, login: null, scopes: [], source: null };
  return { installed: true, ...parseAuthStatus(`${result.stdout}\n${result.stderr}`) };
}
