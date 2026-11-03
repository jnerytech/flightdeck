/**
 * Phase 36: start from a GitHub project. Clones the repo into an allowed root (or reuses the clone
 * it finds there), registers it as a board project, then opens a card or a session, with the issue
 * quoted when one was picked.
 */
import type { Board } from "../board/board.ts";
import type { Issues } from "../issues/issues.ts";
import type { GitRunner } from "../project-find.ts";
import type { GhRunner } from "./gh.ts";

export interface GithubStartRequest {
  /** `owner/name`. */
  repo: string;
  /** An issue number of that repo. */
  issue?: string;
  /** An allowed root: the clone goes inside it. */
  root: string;
  mode: "card" | "session";
}

export interface GithubStartResult {
  projectId: string;
  path: string;
  cardId?: string;
  sessionId?: string;
  /** True when the folder was already a clone of the repo. */
  reused: boolean;
}

export interface GithubStartDeps {
  gh: GhRunner;
  git: GitRunner;
  roots: readonly string[];
  board: Board;
  issues: Issues;
  startSession(opts: { cwd: string; prompt: string; name: string }): Promise<{ sessionId: string }>;
}

export async function startFromGithub(
  _request: GithubStartRequest,
  _deps: GithubStartDeps,
): Promise<GithubStartResult> {
  return { projectId: "", path: "", reused: true };
}
